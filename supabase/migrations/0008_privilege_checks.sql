-- 権限の検査を、実行する役割に左右されない形に置き換える（07 I-DB-18 (10)、A-11）。
--
-- 0005_public_views.sql の末尾の検査は information_schema の *_grants / *_privileges を読むので、
-- 読み取り専用の役割（Supabase CLI の db query --remote --read-only）で流すと行が見えず、
-- 偽の違反（missing table grant）や偽の合格が出た（2026-11-08 に本番で確認）。
-- supabase/checks/ の 2 つのファイルを pg_catalog の ACL と has_*_privilege だけで判定する形に直し、
-- 同じ本文をここに写す。スキーマと権限は変えない（検査して、違反があれば適用を失敗させるだけ）。
-- 0005 の検査は適用済みなので書き換えない。以後、ファイルとの一致を確かめる相手はこのマイグレーション。

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
select 'table grant: ' || case when acl.grantee = 0 then 'PUBLIC' else acl.grantee::regrole::text end
  || ' ' || n.nspname || '.' || cl.relname || ' ' || acl.privilege_type as violation
from pg_class cl
join pg_namespace n on n.oid = cl.relnamespace
cross join lateral aclexplode(cl.relacl) as acl
where cl.relkind in ('r', 'v', 'm', 'f', 'p')
  and (acl.grantee = 0 or acl.grantee in ('anon'::regrole, 'authenticated'::regrole))
  and n.nspname not in (select nspname from managed)
  and not (
    acl.grantee = 'anon'::regrole
    and n.nspname = 'public'
    and cl.relname like 'pub\_%'
    and acl.privilege_type = 'SELECT'
  )
union all
select 'routine grant: ' || case when acl.grantee = 0 then 'PUBLIC' else acl.grantee::regrole::text end
  || ' ' || n.nspname || '.' || p.proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as acl
where (acl.grantee = 0 or acl.grantee in ('anon'::regrole, 'authenticated'::regrole))
  and n.nspname not in (select nspname from managed)
union all
select 'usage grant: ' || case when acl.grantee = 0 then 'PUBLIC' else acl.grantee::regrole::text end
  || ' ' || n.nspname || '.' || cl.relname
from pg_class cl
join pg_namespace n on n.oid = cl.relnamespace
cross join lateral aclexplode(coalesce(cl.relacl, acldefault('s', cl.relowner))) as acl
where cl.relkind = 'S'
  and (acl.grantee = 0 or acl.grantee in ('anon'::regrole, 'authenticated'::regrole))
  and n.nspname not in (select nspname from managed)
union all
select 'usage grant: ' || case when acl.grantee = 0 then 'PUBLIC' else acl.grantee::regrole::text end
  || ' ' || n.nspname || '.' || t.typname
from pg_type t
join pg_namespace n on n.oid = t.typnamespace
cross join lateral aclexplode(coalesce(t.typacl, acldefault('T', t.typowner))) as acl
where t.typtype = 'd'
  and (acl.grantee = 0 or acl.grantee in ('anon'::regrole, 'authenticated'::regrole))
  and n.nspname not in (select nspname from managed)
union all
select 'usage grant: ' || case when acl.grantee = 0 then 'PUBLIC' else acl.grantee::regrole::text end
  || ' foreign data wrapper ' || w.fdwname
from pg_foreign_data_wrapper w
cross join lateral aclexplode(coalesce(w.fdwacl, acldefault('F', w.fdwowner))) as acl
where acl.grantee = 0 or acl.grantee in ('anon'::regrole, 'authenticated'::regrole)
union all
select 'usage grant: ' || case when acl.grantee = 0 then 'PUBLIC' else acl.grantee::regrole::text end
  || ' foreign server ' || s.srvname
from pg_foreign_server s
cross join lateral aclexplode(coalesce(s.srvacl, acldefault('S', s.srvowner))) as acl
where acl.grantee = 0 or acl.grantee in ('anon'::regrole, 'authenticated'::regrole)
union all
select 'owner: ' || o.owner::regrole::text || ' ' || o.kind || ' ' || o.name
from (
  select cl.relowner as owner, 'relation' as kind, n.nspname || '.' || cl.relname as name
  from pg_class cl join pg_namespace n on n.oid = cl.relnamespace
  union all
  select p.proowner, 'function', n.nspname || '.' || p.proname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  union all
  select t.typowner, 'type', n.nspname || '.' || t.typname
  from pg_type t join pg_namespace n on n.oid = t.typnamespace
  union all
  select n.nspowner, 'schema', n.nspname
  from pg_namespace n
) as o
where o.owner in ('anon'::regrole, 'authenticated'::regrole)
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
select 'relation grant: ' || case when acl.grantee = 0 then 'PUBLIC' else acl.grantee::regrole::text end || ' ' || n.nspname || '.' || cl.relname || ' ' || acl.privilege_type
from pg_class cl
join pg_namespace n on n.oid = cl.relnamespace
cross join lateral aclexplode(cl.relacl) as acl
where n.nspname = 'public'
  and acl.grantee <> cl.relowner
  and not (acl.grantee = 'anon'::regrole and acl.privilege_type = 'SELECT')
union all
select 'default privilege: ' || case when acl.grantee = 0 then 'PUBLIC' else acl.grantee::regrole::text end || ' ' || n.nspname || ' ' || d.defaclobjtype::text
from pg_default_acl d
join pg_namespace n on n.oid = d.defaclnamespace
cross join lateral aclexplode(d.defaclacl) as acl
where d.defaclrole = 'postgres'::regrole
  and n.nspname in ('public', 'internal')
  and acl.grantee <> d.defaclrole
union all
select 'schema create: ' || role_name || ' ' || n.nspname
from (values ('anon'), ('authenticated')) as role (role_name)
cross join pg_namespace n
where has_schema_privilege(role.role_name, n.oid, 'CREATE')
union all
select 'service_role on internal: schema ' || p.privilege_type
from (values ('USAGE'), ('CREATE')) as p (privilege_type)
where has_schema_privilege('service_role', 'internal', p.privilege_type)
union all
select 'effective privilege: ' || r.role_name || ' ' || n.nspname || '.' || cl.relname || ' ' || p.privilege_type
from (values ('anon'), ('authenticated'), ('service_role')) as r (role_name)
cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) as p (privilege_type)
cross join pg_class cl
join pg_namespace n on n.oid = cl.relnamespace
where cl.relkind in ('r', 'v', 'm', 'f', 'p')
  and n.nspname in ('public', 'internal')
  and has_table_privilege(r.role_name, cl.oid, p.privilege_type)
  and not (
    r.role_name = 'anon'
    and n.nspname = 'public'
    and cl.relname like 'pub\_%'
    and p.privilege_type = 'SELECT'
  )
union all
select 'column grant: ' || case when acl.grantee = 0 then 'PUBLIC' else acl.grantee::regrole::text end || ' ' || n.nspname || '.' || cl.relname || '.' || a.attname
from pg_attribute a
join pg_class cl on cl.oid = a.attrelid
join pg_namespace n on n.oid = cl.relnamespace
cross join lateral aclexplode(a.attacl) as acl
where n.nspname in ('public', 'internal')
  and not a.attisdropped
union all
select 'mask column: ' || cl.relname || '.' || a.attname
from pg_attribute a
join pg_class cl on cl.oid = a.attrelid
join pg_namespace n on n.oid = cl.relnamespace
where n.nspname = 'public'
  and cl.relname like 'pub\_%'
  and a.attname like '%\_mask%'
  and a.attnum > 0
  and not a.attisdropped
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
  select n.nspname as table_schema, cl.relname as table_name, acl.privilege_type
  from pg_class cl
  join pg_namespace n on n.oid = cl.relnamespace
  cross join lateral aclexplode(cl.relacl) as acl
  where cl.relkind in ('r', 'v', 'm', 'f', 'p')
    and acl.grantee = 'batch_writer'::regrole
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
select 'routine grant: ' || n.nspname || '.' || p.proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral aclexplode(p.proacl) as acl
where acl.grantee = 'batch_writer'::regrole
  and not (n.nspname = 'internal' and p.proname = 'counts_is_numeric')
union all
select 'usage grant: ' || n.nspname || '.' || cl.relname
from pg_class cl
join pg_namespace n on n.oid = cl.relnamespace
cross join lateral aclexplode(cl.relacl) as acl
where cl.relkind = 'S'
  and acl.grantee = 'batch_writer'::regrole
union all
select 'usage grant: ' || n.nspname || '.' || t.typname
from pg_type t
join pg_namespace n on n.oid = t.typnamespace
cross join lateral aclexplode(t.typacl) as acl
where acl.grantee = 'batch_writer'::regrole
union all
select 'usage grant: foreign data wrapper ' || w.fdwname
from pg_foreign_data_wrapper w
cross join lateral aclexplode(w.fdwacl) as acl
where acl.grantee = 'batch_writer'::regrole
union all
select 'usage grant: foreign server ' || s.srvname
from pg_foreign_server s
cross join lateral aclexplode(s.srvacl) as acl
where acl.grantee = 'batch_writer'::regrole
union all
select 'owner: ' || o.kind || ' ' || o.name
from (
  select cl.relowner as owner, 'relation' as kind, n.nspname || '.' || cl.relname as name
  from pg_class cl join pg_namespace n on n.oid = cl.relnamespace
  union all
  select p.proowner, 'function', n.nspname || '.' || p.proname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  union all
  select t.typowner, 'type', n.nspname || '.' || t.typname
  from pg_type t join pg_namespace n on n.oid = t.typnamespace
  union all
  select n.nspowner, 'schema', n.nspname
  from pg_namespace n
) as o
where o.owner = 'batch_writer'::regrole
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
