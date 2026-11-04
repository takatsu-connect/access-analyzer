-- anon / authenticated / PUBLIC の権限と _mask 列の検査（02 §6 の 1〜3、07 I-DB-01、I-DB-03、I-DB-15）。
-- public の表・ビューに owner と anon の select 以外の権限がないことと、既定権限も確かめる（service_role を含む）。
-- 違反を 1 行ずつ返す。0 行なら合格。同じ select を 0005_public_views.sql の末尾に写してある。
-- Supabase が管理するスキーマ（下の managed）には基盤が与えた権限があり、本プロジェクトは変更しない（02 §6）。
-- 本番で管理スキーマの一覧が違い、一覧の外に anon の権限があれば失敗する。これは意図どおりで、確かめてから一覧を直す。
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
select 'column grant: ' || acl.grantee::regrole::text || ' ' || n.nspname || '.' || cl.relname || '.' || a.attname
from pg_attribute a
join pg_class cl on cl.oid = a.attrelid
join pg_namespace n on n.oid = cl.relnamespace
cross join lateral aclexplode(a.attacl) as acl
where n.nspname in ('public', 'internal')
  and not a.attisdropped
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
;
