-- internal スキーマ、既定権限の取り消し、batch_writer、期間と WordPress の次元表（02 §3.1、§3.3、§6、§8）。
-- ロールの認証情報はどのマイグレーションにも書かない（W-4）。

create schema internal;
revoke all on schema internal from public;
revoke all on schema internal from anon, authenticated;

-- 以後 internal / public に作るものに、anon / authenticated / PUBLIC への既定の grant を付けない
alter default privileges for role postgres in schema internal revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema internal revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema internal revoke all on functions from anon, authenticated;
alter default privileges for role postgres in schema internal revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;
-- 関数の EXECUTE は既定で PUBLIC に付き、PostgREST が rpc として公開するので外す（L-4）
alter default privileges for role postgres in schema public revoke execute on functions from public;
-- service_role も外す。既定のままだと pub_* に全権限が付き、自動更新可能なビューを通じて内部表へ書き込める
alter default privileges for role postgres in schema public revoke all on tables from service_role;
alter default privileges for role postgres in schema public revoke all on sequences from service_role;
alter default privileges for role postgres in schema public revoke all on functions from service_role;

-- ロールはクラスタ全体のオブジェクトなので、再適用に備えて存在を確認する
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'batch_writer') then
    create role batch_writer nologin noinherit nobypassrls;
  end if;
end
$$;

-- if not exists は既存のロールの属性を直さないので揃える（W-8）。残りの属性は末尾の検査で確かめる
alter role batch_writer nologin noinherit;
-- 既定のタイムアウトと接続の上限（経路監査 L-3、ADR 0009）
alter role batch_writer connection limit 2;
alter role batch_writer set statement_timeout = '120s';

grant usage on schema internal to batch_writer;

-- service_role には internal の権限を与えない
revoke all on schema internal from service_role;
alter default privileges for role postgres in schema internal revoke all on tables from service_role;
alter default privileges for role postgres in schema internal revoke all on sequences from service_role;
alter default privileges for role postgres in schema internal revoke all on functions from service_role;

-- 期間（02 §2.2、§3.3）
create table internal.period (
  period_id text primary key,
  kind text not null check (kind in ('window', 'month')),
  start_date date not null,
  end_date date not null,
  base_date date not null,
  is_confirmed boolean not null,
  updated_at timestamptz not null default now(),
  check (start_date <= end_date),
  check (kind = 'month' or not is_confirmed)
);
alter table internal.period enable row level security;
revoke all on internal.period from anon, authenticated;
grant select, insert, update, delete on internal.period to batch_writer;
create policy batch_writer_all on internal.period for all to batch_writer using (true) with check (true);

create table internal.wp_author (
  author_slug text primary key,
  display_name text not null,
  author_url text not null,
  first_seen_on date not null,
  updated_at timestamptz not null default now()
);
alter table internal.wp_author enable row level security;
revoke all on internal.wp_author from anon, authenticated;
grant select, insert, update, delete on internal.wp_author to batch_writer;
create policy batch_writer_all on internal.wp_author for all to batch_writer using (true) with check (true);

create table internal.wp_post (
  post_id integer primary key,
  title text not null,
  post_url text not null,
  author_slug text not null references internal.wp_author (author_slug),
  published_at timestamptz not null,
  published_on date not null,
  modified_at timestamptz not null,
  is_ad boolean not null default false,
  first_seen_on date not null,
  updated_at timestamptz not null default now()
);
create index wp_post_author_slug_idx on internal.wp_post (author_slug);
alter table internal.wp_post enable row level security;
revoke all on internal.wp_post from anon, authenticated;
grant select, insert, update, delete on internal.wp_post to batch_writer;
create policy batch_writer_all on internal.wp_post for all to batch_writer using (true) with check (true);

create table internal.wp_category (
  category_id integer primary key,
  name text not null,
  parent_id integer references internal.wp_category (category_id),
  path text not null,
  updated_at timestamptz not null default now()
);
alter table internal.wp_category enable row level security;
revoke all on internal.wp_category from anon, authenticated;
grant select, insert, update, delete on internal.wp_category to batch_writer;
create policy batch_writer_all on internal.wp_category for all to batch_writer using (true) with check (true);

create table internal.wp_tag (
  tag_id integer primary key,
  name text not null,
  updated_at timestamptz not null default now()
);
alter table internal.wp_tag enable row level security;
revoke all on internal.wp_tag from anon, authenticated;
grant select, insert, update, delete on internal.wp_tag to batch_writer;
create policy batch_writer_all on internal.wp_tag for all to batch_writer using (true) with check (true);

create table internal.wp_post_category (
  post_id integer not null references internal.wp_post (post_id) on delete cascade,
  category_id integer not null references internal.wp_category (category_id),
  updated_at timestamptz not null default now(),
  primary key (post_id, category_id)
);
create index wp_post_category_category_id_idx on internal.wp_post_category (category_id);
alter table internal.wp_post_category enable row level security;
revoke all on internal.wp_post_category from anon, authenticated;
grant select, insert, update, delete on internal.wp_post_category to batch_writer;
create policy batch_writer_all on internal.wp_post_category for all to batch_writer using (true) with check (true);

create table internal.wp_post_tag (
  post_id integer not null references internal.wp_post (post_id) on delete cascade,
  tag_id integer not null references internal.wp_tag (tag_id),
  updated_at timestamptz not null default now(),
  primary key (post_id, tag_id)
);
create index wp_post_tag_tag_id_idx on internal.wp_post_tag (tag_id);
alter table internal.wp_post_tag enable row level security;
revoke all on internal.wp_post_tag from anon, authenticated;
grant select, insert, update, delete on internal.wp_post_tag to batch_writer;
create policy batch_writer_all on internal.wp_post_tag for all to batch_writer using (true) with check (true);
