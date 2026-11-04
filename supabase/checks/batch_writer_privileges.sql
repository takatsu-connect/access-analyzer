-- batch_writer の権限の検査（02 §6、W-8、07 I-DB-18、A-11）。違反を 1 行ずつ返す。0 行なら合格。
-- 同じ select を 0005_public_views.sql の末尾に写してある。本文の一致は I-DB-18 (10) で確かめる。
-- ログインの可否は検査しない（手順の前後で変わるため）。
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
select 'effective privilege: ' || n.nspname || '.' || cl.relname || ' ' || p.privilege_type
from (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) as p (privilege_type)
cross join pg_class cl
join pg_namespace n on n.oid = cl.relnamespace
where cl.relkind in ('r', 'v', 'm', 'f', 'p')
  and n.nspname in ('public', 'internal')
  and has_table_privilege('batch_writer', cl.oid, p.privilege_type)
  and not (
    n.nspname = 'internal'
    and exists (
      select 1 from allowed_grant a
      where a.table_name = cl.relname and a.privilege_type = p.privilege_type
    )
  )
union all
select 'column grant: ' || n.nspname || '.' || cl.relname || '.' || a.attname
from pg_attribute a
join pg_class cl on cl.oid = a.attrelid
join pg_namespace n on n.oid = cl.relnamespace
cross join lateral aclexplode(a.attacl) as acl
where acl.grantee = 'batch_writer'::regrole
  and not a.attisdropped
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
;
