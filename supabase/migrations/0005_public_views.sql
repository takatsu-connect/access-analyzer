-- 分布の内部ビューと公開ビュー（02 §4、§4.1）。公開ビューは所有者権限で internal を読む。
-- _mask 列を出さない。internal のビューを batch_writer に grant しない。

-- n 日目の累積（M-18）。公開日を 1 日目とし、公開前の日は含めない。欠けた日は 0。n は 1〜90。
create view internal.article_cumulative as
select
  p.post_id,
  g.n,
  (sum(coalesce(d.pageviews, 0)) over (partition by p.post_id order by g.n))::integer as cumulative_pv
from internal.wp_post p
join internal.article_summary s on s.post_id = p.post_id
cross join lateral generate_series(1, least(s.age_days, 90)) as g (n)
left join internal.article_daily d
  on d.post_id = p.post_id
  and d.day = p.published_on + (g.n - 1);

-- 全記事の分布（M-19、M-27）。母集団は広告を除く公開記事で、age_days >= n は累積の行の有無で満たす。
-- 下の 30 は設定値 BENCHMARK_MIN_POPULATION（07 I-DB-17 で一致を確かめる）。
create view internal.benchmark_curve as
with population as (
  select
    'all'::text as scope,
    c.n,
    c.cumulative_pv,
    p.published_on >= s.base_date - 365 as in_12m,
    s.base_date
  from internal.article_cumulative c
  join internal.wp_post p on p.post_id = c.post_id
  join internal.article_summary s on s.post_id = c.post_id
  where not p.is_ad
  union all
  select
    'cat:' || cat.category_id::text,
    c.n,
    c.cumulative_pv,
    p.published_on >= s.base_date - 365,
    s.base_date
  from internal.article_cumulative c
  join internal.wp_post p on p.post_id = c.post_id
  join internal.article_summary s on s.post_id = c.post_id
  join internal.wp_post_category pc on pc.post_id = c.post_id
  join internal.wp_category cat on cat.category_id = pc.category_id and cat.parent_id is not null
  where not p.is_ad
),
aggregated as (
  select
    scope,
    n,
    max(base_date) as base_date,
    count(*) filter (where in_12m) as size_12m,
    count(*) as size_all,
    percentile_cont(array[0.25, 0.5, 0.75]) within group (order by cumulative_pv)
      filter (where in_12m) as q_12m,
    percentile_cont(array[0.25, 0.5, 0.75]) within group (order by cumulative_pv) as q_all
  from population
  group by scope, n
)
select
  scope,
  n,
  case when size_12m >= 30 then q_12m[1] else q_all[1] end as p25,
  case when size_12m >= 30 then q_12m[2] else q_all[2] end as p50,
  case when size_12m >= 30 then q_12m[3] else q_all[3] end as p75,
  (case when size_12m >= 30 then size_12m else size_all end)::integer as population_size,
  case when size_12m >= 30 then '12m' else 'all' end as population_window,
  base_date
from aggregated
where size_all >= 30;

-- ここから公開ビュー。作成の直後に anon へ select だけを与える（02 §6）。

create view public.pub_meta as
select
  last_success.base_date,
  last_success.finished_at,
  last_success.mask_threshold,
  coalesce(
    last_success.base_date < (now() at time zone 'Asia/Tokyo')::date - 1,
    true
  ) as is_stale,
  last_run.status as last_status
from (select 1) as one
left join lateral (
  select r.base_date, r.finished_at, r.mask_threshold
  from internal.batch_run r
  where r.status = 'success'
  order by r.finished_at desc nulls last, r.run_id desc
  limit 1
) as last_success on true
left join lateral (
  select r.status
  from internal.batch_run r
  order by r.run_id desc
  limit 1
) as last_run on true;
grant select on public.pub_meta to anon;

create view public.pub_batch_run as
select run_id, started_at, finished_at, base_date, mode, status, failed_step, error_kind
from internal.batch_run
order by run_id desc
limit 30;
grant select on public.pub_batch_run to anon;

create view public.pub_period as
select period_id, kind, start_date, end_date, is_confirmed
from internal.period;
grant select on public.pub_period to anon;

create view public.pub_author as
select author_slug, display_name, author_url
from internal.wp_author;
grant select on public.pub_author to anon;

create view public.pub_post as
select
  p.post_id,
  p.title,
  p.post_url,
  p.author_slug,
  a.display_name,
  p.published_on,
  p.is_ad,
  s.age_days,
  s.freshness
from internal.wp_post p
join internal.wp_author a on a.author_slug = p.author_slug
left join internal.article_summary s on s.post_id = p.post_id;
grant select on public.pub_post to anon;

create view public.pub_category as
select category_id, name, parent_id, path
from internal.wp_category;
grant select on public.pub_category to anon;

create view public.pub_tag as
select tag_id, name
from internal.wp_tag;
grant select on public.pub_tag to anon;

create view public.pub_post_category as
select post_id, category_id
from internal.wp_post_category;
grant select on public.pub_post_category to anon;

create view public.pub_post_tag as
select post_id, tag_id
from internal.wp_post_tag;
grant select on public.pub_post_tag to anon;

create view public.pub_site_daily as
select day, pageviews, sessions
from internal.site_daily;
grant select on public.pub_site_daily to anon;

create view public.pub_site_daily_channel as
select day, channel, sessions
from internal.site_daily_channel;
grant select on public.pub_site_daily_channel to anon;

create view public.pub_site_daily_device as
select day, device, pageviews, sessions
from internal.site_daily_device;
grant select on public.pub_site_daily_device to anon;

create view public.pub_site_period as
select
  per.period_id,
  coalesce(daily.pageviews, 0) as pageviews,
  coalesce(daily.sessions, 0) as sessions,
  sp.active_users,
  sp.engagement_seconds,
  per.end_date - per.start_date + 1 as days
from internal.period per
left join internal.site_period sp on sp.period_id = per.period_id
left join lateral (
  select sum(d.pageviews)::bigint as pageviews, sum(d.sessions)::bigint as sessions
  from internal.site_daily d
  where d.day between per.start_date and per.end_date
) as daily on true;
grant select on public.pub_site_period to anon;

create view public.pub_site_period_breakdown as
select period_id, axis, bucket, value
from internal.site_period_breakdown;
grant select on public.pub_site_period_breakdown to anon;

create view public.pub_site_period_heatmap as
select period_id, dow, hour, pageviews
from internal.site_period_heatmap;
grant select on public.pub_site_period_heatmap to anon;

create view public.pub_site_period_freshness as
select
  ap.period_id,
  s.freshness,
  count(*)::integer as post_count,
  sum(ap.pageviews)::bigint as pageviews
from internal.article_period ap
join internal.article_summary s on s.post_id = ap.post_id
group by ap.period_id, s.freshness;
grant select on public.pub_site_period_freshness to anon;

-- 確定した暦月だけを出す（02 §3.4、07 I-DB-10）
create view public.pub_site_month_referrer as
select r.period_id, r.rank, r.source_domain, r.sessions
from internal.site_month_referrer r
join internal.period per on per.period_id = r.period_id
where per.kind = 'month' and per.is_confirmed;
grant select on public.pub_site_month_referrer to anon;

create view public.pub_site_month_city as
select c.period_id, c.rank, c.region, c.city, c.sessions
from internal.site_month_city c
join internal.period per on per.period_id = c.period_id
where per.kind = 'month' and per.is_confirmed;
grant select on public.pub_site_month_city to anon;

create view public.pub_article_daily as
select post_id, day, pageviews
from internal.article_daily;
grant select on public.pub_article_daily to anon;

create view public.pub_article_cumulative as
select post_id, n, cumulative_pv
from internal.article_cumulative;
grant select on public.pub_article_cumulative to anon;

create view public.pub_article_period as
select post_id, period_id, pageviews, landing_sessions, scroll_count, engagement_seconds
from internal.article_period;
grant select on public.pub_article_period to anon;

create view public.pub_article_period_breakdown as
select post_id, period_id, axis, bucket, sessions
from internal.article_period_breakdown;
grant select on public.pub_article_period_breakdown to anon;

-- 計算済みの記事だけを出す（07 I-DB-10）
create view public.pub_article_referrer_30d as
select r.post_id, r.rank, r.source_domain, r.sessions
from internal.article_referrer_30d r
join internal.article_summary s on s.post_id = r.post_id
where s.referrer_30d_computed_on is not null;
grant select on public.pub_article_referrer_30d to anon;

-- 帯は曲線 (all, n) と比べる。p25 / p75 と等しいときは middle（03 §6.2）。
create view public.pub_article_summary as
select
  s.post_id,
  s.age_days,
  s.freshness,
  s.pv_7d,
  s.pv_30d,
  s.pv_total,
  case
    when s.age_days < 7 or c7.cumulative_pv is null or b7.scope is null then null
    when c7.cumulative_pv > b7.p75 then 'upper'
    when c7.cumulative_pv < b7.p25 then 'lower'
    else 'middle'
  end as band_7d,
  case
    when s.age_days < 3 or c30.cumulative_pv is null or b30.scope is null then null
    when c30.cumulative_pv > b30.p75 then 'upper'
    when c30.cumulative_pv < b30.p25 then 'lower'
    else 'middle'
  end as band_30d,
  s.is_recent_hot,
  s.is_revival,
  s.is_evergreen_365,
  s.referrer_30d_computed_on
from internal.article_summary s
left join internal.article_cumulative c7
  on c7.post_id = s.post_id and c7.n = 7
left join internal.benchmark_curve b7
  on b7.scope = 'all' and b7.n = 7
left join internal.article_cumulative c30
  on c30.post_id = s.post_id and c30.n = least(s.age_days, 30)
left join internal.benchmark_curve b30
  on b30.scope = 'all' and b30.n = least(s.age_days, 30);
grant select on public.pub_article_summary to anon;

create view public.pub_article_milestone as
select post_id, milestone, reached_on
from internal.article_milestone;
grant select on public.pub_article_milestone to anon;

create view public.pub_author_period as
select
  p.author_slug,
  per.period_id,
  (count(*) filter (where p.published_on between per.start_date and per.end_date))::integer as post_count,
  coalesce(sum(ap.pageviews), 0)::bigint as pageviews,
  (count(*) filter (where s.freshness = 'long'))::integer as long_post_count,
  coalesce(sum(ap.pageviews) filter (where s.freshness = 'long'), 0)::bigint as long_pageviews
from internal.wp_post p
cross join internal.period per
left join internal.article_period ap on ap.post_id = p.post_id and ap.period_id = per.period_id
left join internal.article_summary s on s.post_id = p.post_id
group by p.author_slug, per.period_id;
grant select on public.pub_author_period to anon;

create view public.pub_author_period_breakdown as
select author_slug, period_id, axis, bucket, sessions
from internal.author_period_breakdown;
grant select on public.pub_author_period_breakdown to anon;

create view public.pub_author_category_period as
select
  p.author_slug,
  pc.category_id,
  per.period_id,
  count(*)::integer as post_count,
  coalesce(sum(ap.pageviews), 0)::bigint as pageviews
from internal.wp_post p
join internal.wp_post_category pc on pc.post_id = p.post_id
cross join internal.period per
left join internal.article_period ap on ap.post_id = p.post_id and ap.period_id = per.period_id
group by p.author_slug, pc.category_id, per.period_id;
grant select on public.pub_author_category_period to anon;

create view public.pub_author_summary as
select
  a.author_slug,
  a.own_median_30d,
  a.eligible_count,
  case
    when a.own_median_30d is null or b.scope is null then null
    when a.own_median_30d > b.p75 then 'upper'
    when a.own_median_30d < b.p25 then 'lower'
    else 'middle'
  end as band_30d
from internal.author_summary a
left join internal.benchmark_curve b on b.scope = 'all' and b.n = 30;
grant select on public.pub_author_summary to anon;

-- 親カテゴリの行は、親または配下の子に属する記事を distinct で数える（02 §4）
create view public.pub_category_period as
with membership as (
  select distinct c.category_id, pc.post_id
  from internal.wp_category c
  join internal.wp_category member
    on member.category_id = c.category_id or member.parent_id = c.category_id
  join internal.wp_post_category pc on pc.category_id = member.category_id
)
select
  m.category_id,
  per.period_id,
  coalesce(sum(ap.pageviews), 0)::bigint as pageviews,
  count(*)::integer as post_count_total,
  (count(*) filter (where p.published_on between per.start_date and per.end_date))::integer
    as post_count_published,
  percentile_cont(0.5) within group (order by s.pv_30d)
    filter (where p.published_on between per.start_date and per.end_date and s.pv_30d is not null)
    as median_30d_pv,
  (count(*) filter (
    where p.published_on between per.start_date and per.end_date and s.pv_30d is not null
  ))::integer as published_post_count_30d
from membership m
join internal.wp_post p on p.post_id = m.post_id
cross join internal.period per
left join internal.article_period ap on ap.post_id = m.post_id and ap.period_id = per.period_id
left join internal.article_summary s on s.post_id = m.post_id
group by m.category_id, per.period_id;
grant select on public.pub_category_period to anon;

create view public.pub_tag_period as
select
  pt.tag_id,
  per.period_id,
  coalesce(sum(ap.pageviews), 0)::bigint as pageviews,
  count(*)::integer as post_count
from internal.wp_post_tag pt
cross join internal.period per
left join internal.article_period ap on ap.post_id = pt.post_id and ap.period_id = per.period_id
group by pt.tag_id, per.period_id;
grant select on public.pub_tag_period to anon;

create view public.pub_posting_monthly as
select
  date_trunc('month', published_on)::date as month,
  count(*)::integer as post_count
from internal.wp_post
group by 1;
grant select on public.pub_posting_monthly to anon;

create view public.pub_posting_period as
select
  per.period_id,
  count(p.post_id)::integer as post_count
from internal.period per
left join internal.wp_post p on p.published_on between per.start_date and per.end_date
group by per.period_id;
grant select on public.pub_posting_period to anon;

create view public.pub_benchmark_curve as
select scope, n, p25, p50, p75, population_size, population_window
from internal.benchmark_curve;
grant select on public.pub_benchmark_curve to anon;

-- 既定権限に頼らず、anon の select 以外がないことを明示する。単純なビューは自動更新可能なので、
-- 書き込みの権限が残ると内部表まで届く（02 §6）。
revoke all on
  public.pub_meta, public.pub_batch_run, public.pub_period, public.pub_author, public.pub_post,
  public.pub_category, public.pub_tag, public.pub_post_category, public.pub_post_tag,
  public.pub_site_daily, public.pub_site_daily_channel, public.pub_site_daily_device,
  public.pub_site_period, public.pub_site_period_breakdown, public.pub_site_period_heatmap,
  public.pub_site_period_freshness, public.pub_site_month_referrer, public.pub_site_month_city,
  public.pub_article_daily, public.pub_article_cumulative, public.pub_article_period,
  public.pub_article_period_breakdown, public.pub_article_referrer_30d,
  public.pub_article_summary, public.pub_article_milestone, public.pub_author_period,
  public.pub_author_period_breakdown, public.pub_author_category_period,
  public.pub_author_summary, public.pub_category_period, public.pub_tag_period,
  public.pub_posting_monthly, public.pub_posting_period, public.pub_benchmark_curve
from public, authenticated, service_role;

-- 権限の検査: anon / authenticated / PUBLIC の権限と _mask 列。supabase/checks/anon_privileges.sql と同じ本文（07 I-DB-18 (10)）。
do $check$
declare
  violations text;
begin
  select string_agg(v.violation, '; ') into violations
  from (
-- BEGIN CHECK anon_privileges
with managed (nspname) as (
  values
    ('pg_catalog'), ('information_schema'),
    ('auth'), ('extensions'), ('graphql'), ('graphql_public'),
    ('realtime'), ('storage'), ('supabase_functions')
)
select 'table grant: ' || g.grantee || ' ' || g.table_schema || '.' || g.table_name || ' ' || g.privilege_type as violation
from information_schema.role_table_grants g
where g.grantee in ('anon', 'authenticated', 'PUBLIC')
  and g.table_schema not in (select nspname from managed)
  and not (
    g.grantee = 'anon'
    and g.table_schema = 'public'
    and g.table_name like 'pub\_%'
    and g.privilege_type = 'SELECT'
  )
union all
select 'routine grant: ' || r.grantee || ' ' || r.routine_schema || '.' || r.routine_name
from information_schema.routine_privileges r
where r.grantee in ('anon', 'authenticated', 'PUBLIC')
  and r.routine_schema not in (select nspname from managed)
union all
select 'usage grant: ' || u.grantee || ' ' || u.object_schema || '.' || u.object_name
from information_schema.role_usage_grants u
where u.grantee in ('anon', 'authenticated', 'PUBLIC')
  and u.object_schema not in (select nspname from managed)
union all
select 'schema usage: ' || role_name || ' ' || n.nspname
from (values ('anon'), ('authenticated')) as role (role_name)
cross join pg_namespace n
where has_schema_privilege(role.role_name, n.oid, 'USAGE')
  and n.nspname <> 'public'
  and n.nspname not in (select nspname from managed)
union all
select 'schema usage: PUBLIC ' || n.nspname
from pg_namespace n
cross join lateral aclexplode(n.nspacl) as acl
where acl.grantee = 0
  and acl.privilege_type = 'USAGE'
  and n.nspname <> 'public'
  and n.nspname not in (select nspname from managed)
union all
select 'schema create: PUBLIC ' || n.nspname
from pg_namespace n
cross join lateral aclexplode(n.nspacl) as acl
where acl.grantee = 0 and acl.privilege_type = 'CREATE'
union all
select 'relation grant: ' || acl.grantee::regrole::text || ' ' || n.nspname || '.' || cl.relname || ' ' || acl.privilege_type
from pg_class cl
join pg_namespace n on n.oid = cl.relnamespace
cross join lateral aclexplode(cl.relacl) as acl
where n.nspname = 'public'
  and acl.grantee <> cl.relowner
  and not (acl.grantee = 'anon'::regrole and acl.privilege_type = 'SELECT')
union all
select 'default privilege: ' || acl.grantee::regrole::text || ' ' || n.nspname || ' ' || d.defaclobjtype::text
from pg_default_acl d
join pg_namespace n on n.oid = d.defaclnamespace
cross join lateral aclexplode(d.defaclacl) as acl
where d.defaclrole = 'postgres'::regrole
  and n.nspname in ('public', 'internal')
  and acl.grantee <> d.defaclrole
union all
select 'mask column: ' || c.table_name || '.' || c.column_name
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name like 'pub\_%'
  and c.column_name like '%\_mask%'
union all
select 'object outside pub_: public.' || cl.relname
from pg_class cl
join pg_namespace n on n.oid = cl.relnamespace
where n.nspname = 'public'
  and cl.relkind in ('r', 'v', 'm', 'f', 'p')
  and cl.relname not like 'pub\_%'
union all
select 'function in public: ' || p.proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
union all
select 'pub_ object in internal: ' || cl.relname
from pg_class cl
join pg_namespace n on n.oid = cl.relnamespace
where n.nspname = 'internal' and cl.relname like 'pub\_%'
-- END CHECK anon_privileges
  ) as v;
  if violations is not null then
    raise exception '権限の検査に失敗: %', violations;
  end if;
end
$check$;

-- 権限の検査: batch_writer の権限。supabase/checks/batch_writer_privileges.sql と同じ本文（07 I-DB-18 (10)）。
do $check$
declare
  violations text;
begin
  select string_agg(v.violation, '; ') into violations
  from (
-- BEGIN CHECK batch_writer_privileges
with allowed_table (table_name) as (
  values
    ('period'), ('wp_author'), ('wp_post'), ('wp_category'), ('wp_tag'),
    ('wp_post_category'), ('wp_post_tag'),
    ('site_daily'), ('site_daily_channel'), ('site_daily_device'), ('article_daily'),
    ('site_period'), ('site_period_breakdown'), ('site_period_heatmap'),
    ('article_period'), ('article_period_breakdown'), ('author_period_breakdown'),
    ('site_month_referrer'), ('site_month_city'), ('article_referrer_30d'),
    ('article_summary'), ('article_milestone'), ('author_summary'),
    ('batch_run'), ('sns_source_unmapped')
),
allowed_grant (table_name, privilege_type) as (
  select t.table_name, p.privilege_type
  from allowed_table t
  cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as p (privilege_type)
  where not (t.table_name = 'batch_run' and p.privilege_type = 'DELETE')
),
actual_grant as (
  select table_schema, table_name, privilege_type
  from information_schema.role_table_grants
  where grantee = 'batch_writer'
)
select 'extra table grant: ' || g.table_schema || '.' || g.table_name || ' ' || g.privilege_type as violation
from actual_grant g
where g.table_schema <> 'internal'
  or not exists (
    select 1 from allowed_grant a
    where a.table_name = g.table_name and a.privilege_type = g.privilege_type
  )
union all
select 'missing table grant: internal.' || a.table_name || ' ' || a.privilege_type
from allowed_grant a
where not exists (
  select 1 from actual_grant g
  where g.table_schema = 'internal'
    and g.table_name = a.table_name
    and g.privilege_type = a.privilege_type
)
union all
select 'schema create: ' || n.nspname
from pg_namespace n
where has_schema_privilege('batch_writer', n.oid, 'CREATE')
union all
select 'schema usage: ' || n.nspname
from pg_namespace n
where has_schema_privilege('batch_writer', n.oid, 'USAGE')
  and n.nspname not in ('internal', 'pg_catalog', 'information_schema')
  and not (
    n.nspname = 'public'
    and exists (
      select 1 from aclexplode(n.nspacl) as acl
      where acl.grantee = 0 and acl.privilege_type = 'USAGE'
    )
    and not exists (
      select 1 from aclexplode(n.nspacl) as acl
      where acl.grantee = 'batch_writer'::regrole
    )
  )
union all
select 'routine grant: ' || r.routine_schema || '.' || r.routine_name
from information_schema.routine_privileges r
where r.grantee = 'batch_writer'
  and not (r.routine_schema = 'internal' and r.routine_name = 'counts_is_numeric')
union all
select 'usage grant: ' || u.object_schema || '.' || u.object_name
from information_schema.role_usage_grants u
where u.grantee = 'batch_writer'
union all
select 'role membership: ' || m.roleid::regrole::text
from pg_auth_members m
where m.member = 'batch_writer'::regrole
union all
select 'role attribute: ' || r.rolname
from pg_roles r
where r.rolname = 'batch_writer'
  and (
    r.rolbypassrls or r.rolsuper or r.rolcreaterole or r.rolcreatedb
    or r.rolreplication or r.rolinherit or r.rolconnlimit <> 2
  )
-- END CHECK batch_writer_privileges
  ) as v;
  if violations is not null then
    raise exception '権限の検査に失敗: %', violations;
  end if;
end
$check$;
