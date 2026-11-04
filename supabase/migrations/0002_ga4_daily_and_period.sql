-- GA4 由来の日別表と期間別表（02 §3.2、§3.3）。
-- 伏せ値の列は <指標名> と <指標名>_mask の 2 列（02 §2.3）。_mask は公開ビューに出さない。

create table internal.site_daily (
  day date primary key,
  pageviews integer not null,
  sessions integer not null,
  updated_at timestamptz not null default now()
);
alter table internal.site_daily enable row level security;
revoke all on internal.site_daily from anon, authenticated;
grant select, insert, update, delete on internal.site_daily to batch_writer;
create policy batch_writer_all on internal.site_daily for all to batch_writer using (true) with check (true);

create table internal.site_daily_channel (
  day date not null,
  channel text not null check (channel in ('search', 'social', 'direct', 'referral', 'other')),
  sessions integer,
  sessions_mask text check (sessions_mask in ('threshold', 'secondary')),
  updated_at timestamptz not null default now(),
  primary key (day, channel)
);
alter table internal.site_daily_channel enable row level security;
revoke all on internal.site_daily_channel from anon, authenticated;
grant select, insert, update, delete on internal.site_daily_channel to batch_writer;
create policy batch_writer_all on internal.site_daily_channel for all to batch_writer using (true) with check (true);

create table internal.site_daily_device (
  day date not null,
  device text not null check (device in ('mobile', 'desktop', 'tablet')),
  pageviews integer,
  pageviews_mask text check (pageviews_mask in ('threshold', 'secondary')),
  sessions integer,
  sessions_mask text check (sessions_mask in ('threshold', 'secondary')),
  updated_at timestamptz not null default now(),
  primary key (day, device)
);
alter table internal.site_daily_device enable row level security;
revoke all on internal.site_daily_device from anon, authenticated;
grant select, insert, update, delete on internal.site_daily_device to batch_writer;
create policy batch_writer_all on internal.site_daily_device for all to batch_writer using (true) with check (true);

create table internal.article_daily (
  post_id integer not null references internal.wp_post (post_id) on delete cascade,
  day date not null,
  pageviews integer not null,
  updated_at timestamptz not null default now(),
  primary key (post_id, day)
);
alter table internal.article_daily enable row level security;
revoke all on internal.article_daily from anon, authenticated;
grant select, insert, update, delete on internal.article_daily to batch_writer;
create policy batch_writer_all on internal.article_daily for all to batch_writer using (true) with check (true);

create table internal.site_period (
  period_id text primary key references internal.period (period_id),
  engagement_seconds bigint not null,
  active_users integer,
  active_users_mask text check (active_users_mask in ('threshold', 'secondary')),
  updated_at timestamptz not null default now()
);
alter table internal.site_period enable row level security;
revoke all on internal.site_period from anon, authenticated;
grant select, insert, update, delete on internal.site_period to batch_writer;
create policy batch_writer_all on internal.site_period for all to batch_writer using (true) with check (true);

create table internal.site_period_breakdown (
  period_id text not null references internal.period (period_id),
  axis text not null check (axis in ('sns', 'new_returning', 'local', 'channel', 'device_pv', 'device_sessions')),
  bucket text not null,
  value integer,
  value_mask text check (value_mask in ('threshold', 'secondary')),
  updated_at timestamptz not null default now(),
  primary key (period_id, axis, bucket)
);
alter table internal.site_period_breakdown enable row level security;
revoke all on internal.site_period_breakdown from anon, authenticated;
grant select, insert, update, delete on internal.site_period_breakdown to batch_writer;
create policy batch_writer_all on internal.site_period_breakdown for all to batch_writer using (true) with check (true);

create table internal.site_period_heatmap (
  period_id text not null references internal.period (period_id),
  dow smallint not null check (dow between 0 and 6),
  hour smallint not null check (hour between 0 and 23),
  pageviews integer,
  pageviews_mask text check (pageviews_mask in ('threshold', 'secondary')),
  updated_at timestamptz not null default now(),
  primary key (period_id, dow, hour)
);
alter table internal.site_period_heatmap enable row level security;
revoke all on internal.site_period_heatmap from anon, authenticated;
grant select, insert, update, delete on internal.site_period_heatmap to batch_writer;
create policy batch_writer_all on internal.site_period_heatmap for all to batch_writer using (true) with check (true);

create table internal.article_period (
  post_id integer not null references internal.wp_post (post_id) on delete cascade,
  period_id text not null references internal.period (period_id),
  pageviews integer not null,
  landing_sessions integer,
  landing_sessions_mask text check (landing_sessions_mask in ('threshold', 'secondary')),
  scroll_count integer,
  scroll_count_mask text check (scroll_count_mask in ('threshold', 'secondary')),
  engagement_seconds integer,
  engagement_seconds_mask text check (engagement_seconds_mask in ('threshold', 'secondary')),
  updated_at timestamptz not null default now(),
  primary key (post_id, period_id)
);
create index article_period_period_id_idx on internal.article_period (period_id);
alter table internal.article_period enable row level security;
revoke all on internal.article_period from anon, authenticated;
grant select, insert, update, delete on internal.article_period to batch_writer;
create policy batch_writer_all on internal.article_period for all to batch_writer using (true) with check (true);

create table internal.article_period_breakdown (
  post_id integer not null references internal.wp_post (post_id) on delete cascade,
  period_id text not null references internal.period (period_id),
  axis text not null check (axis in ('channel', 'sns', 'device')),
  bucket text not null,
  sessions integer,
  sessions_mask text check (sessions_mask in ('threshold', 'secondary')),
  updated_at timestamptz not null default now(),
  primary key (post_id, period_id, axis, bucket)
);
alter table internal.article_period_breakdown enable row level security;
revoke all on internal.article_period_breakdown from anon, authenticated;
grant select, insert, update, delete on internal.article_period_breakdown to batch_writer;
create policy batch_writer_all on internal.article_period_breakdown for all to batch_writer using (true) with check (true);

create table internal.author_period_breakdown (
  author_slug text not null references internal.wp_author (author_slug) on delete cascade,
  period_id text not null references internal.period (period_id),
  axis text not null check (axis in ('channel', 'sns')),
  bucket text not null,
  sessions integer,
  sessions_mask text check (sessions_mask in ('threshold', 'secondary')),
  updated_at timestamptz not null default now(),
  primary key (author_slug, period_id, axis, bucket)
);
alter table internal.author_period_breakdown enable row level security;
revoke all on internal.author_period_breakdown from anon, authenticated;
grant select, insert, update, delete on internal.author_period_breakdown to batch_writer;
create policy batch_writer_all on internal.author_period_breakdown for all to batch_writer using (true) with check (true);
