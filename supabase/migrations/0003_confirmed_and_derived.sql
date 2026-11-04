-- 確定した暦月・公開後 30 日時点の表と派生表（02 §3.4、§3.5）。帯の列は持たない（公開ビューで計算）。
-- 上位 N の sessions の 5 は設定値 MASK_THRESHOLD（T 未満の行を格納しない。テストで一致を確かめる）。

create table internal.site_month_referrer (
  period_id text not null references internal.period (period_id),
  rank smallint not null check (rank between 1 and 10),
  source_domain text not null,
  sessions integer not null check (sessions >= 5),
  updated_at timestamptz not null default now(),
  primary key (period_id, rank)
);
alter table internal.site_month_referrer enable row level security;
revoke all on internal.site_month_referrer from anon, authenticated;
grant select, insert, update, delete on internal.site_month_referrer to batch_writer;
create policy batch_writer_all on internal.site_month_referrer for all to batch_writer using (true) with check (true);

create table internal.site_month_city (
  period_id text not null references internal.period (period_id),
  rank smallint not null check (rank between 1 and 10),
  country text not null check (country = 'Japan'),
  region text not null,
  city text not null,
  sessions integer not null check (sessions >= 5),
  updated_at timestamptz not null default now(),
  primary key (period_id, rank)
);
alter table internal.site_month_city enable row level security;
revoke all on internal.site_month_city from anon, authenticated;
grant select, insert, update, delete on internal.site_month_city to batch_writer;
create policy batch_writer_all on internal.site_month_city for all to batch_writer using (true) with check (true);

create table internal.article_referrer_30d (
  post_id integer not null references internal.wp_post (post_id) on delete cascade,
  rank smallint not null check (rank between 1 and 3),
  source_domain text not null,
  sessions integer not null check (sessions >= 5),
  computed_on date not null,
  updated_at timestamptz not null default now(),
  primary key (post_id, rank)
);
alter table internal.article_referrer_30d enable row level security;
revoke all on internal.article_referrer_30d from anon, authenticated;
grant select, insert, update, delete on internal.article_referrer_30d to batch_writer;
create policy batch_writer_all on internal.article_referrer_30d for all to batch_writer using (true) with check (true);

create table internal.article_summary (
  post_id integer primary key references internal.wp_post (post_id) on delete cascade,
  base_date date not null,
  age_days integer not null,
  freshness text not null check (freshness in ('new', 'mid', 'long')),
  pv_7d integer,
  pv_30d integer,
  pv_total integer not null,
  is_recent_hot boolean not null,
  is_revival boolean not null,
  is_evergreen_365 boolean not null,
  referrer_30d_computed_on date,
  updated_at timestamptz not null default now()
);
alter table internal.article_summary enable row level security;
revoke all on internal.article_summary from anon, authenticated;
grant select, insert, update, delete on internal.article_summary to batch_writer;
create policy batch_writer_all on internal.article_summary for all to batch_writer using (true) with check (true);

create table internal.article_milestone (
  post_id integer not null references internal.wp_post (post_id) on delete cascade,
  milestone integer not null check (milestone in (500, 1000, 5000, 10000)),
  reached_on date not null,
  updated_at timestamptz not null default now(),
  primary key (post_id, milestone)
);
alter table internal.article_milestone enable row level security;
revoke all on internal.article_milestone from anon, authenticated;
grant select, insert, update, delete on internal.article_milestone to batch_writer;
create policy batch_writer_all on internal.article_milestone for all to batch_writer using (true) with check (true);

create table internal.author_summary (
  author_slug text primary key references internal.wp_author (author_slug) on delete cascade,
  base_date date not null,
  own_median_30d numeric,
  eligible_count integer not null,
  updated_at timestamptz not null default now()
);
alter table internal.author_summary enable row level security;
revoke all on internal.author_summary from anon, authenticated;
grant select, insert, update, delete on internal.author_summary to batch_writer;
create policy batch_writer_all on internal.author_summary for all to batch_writer using (true) with check (true);
