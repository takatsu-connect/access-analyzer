-- 運用表（02 §3.6）。batch_run に delete を与えない（経路監査 L-2）。

-- counts は固定キーと数値だけ（設計レビュー L-6）。internal に置く関数はこれだけ（02 §6）。
create function internal.counts_is_numeric(counts jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(counts) = 'object'
    and not exists (
      select 1
      from jsonb_each(counts) as entry (key, value)
      where jsonb_typeof(entry.value) <> 'number'
        or entry.key not in (
          'ga4_requests',
          'ga4_tokens',
          'ga4_tokens_remaining_day',
          'ga4_tokens_remaining_hour',
          'wp_requests',
          'posts_upserted',
          'posts_deleted',
          'rows_written',
          'duration_ms'
        )
    )
$$;
revoke all on function internal.counts_is_numeric(jsonb) from public, anon, authenticated, service_role;
-- check 制約の評価には書き込むロールの EXECUTE が要る（02 §6）
grant execute on function internal.counts_is_numeric(jsonb) to batch_writer;

create table internal.batch_run (
  run_id bigint generated always as identity primary key,
  started_at timestamptz not null,
  finished_at timestamptz,
  base_date date not null,
  mode text not null check (mode in ('daily', 'backfill', 'manual')),
  status text not null check (status in ('running', 'success', 'failed')),
  -- 公開ビューに出るので自由文字列にしない（監査 M-3）。startup は入れない（03 §1）
  failed_step text check (failed_step in (
    'preflight', 'wp_fetch', 'period', 'ga4_daily', 'ga4_period', 'derive', 'write', 'publish'
  )),
  error_kind text check (error_kind in ('quota', 'auth', 'network', 'validation', 'db', 'unknown')),
  mask_threshold smallint not null,
  counts jsonb not null default '{}' check (internal.counts_is_numeric(counts)),
  github_run_id text,
  updated_at timestamptz not null default now()
);
alter table internal.batch_run enable row level security;
revoke all on internal.batch_run from anon, authenticated;
grant select, insert, update on internal.batch_run to batch_writer;
create policy batch_writer_all on internal.batch_run for all to batch_writer using (true) with check (true);

create table internal.sns_source_unmapped (
  source text primary key,
  first_seen_on date not null,
  last_seen_on date not null,
  last_sessions integer not null,
  updated_at timestamptz not null default now()
);
alter table internal.sns_source_unmapped enable row level security;
revoke all on internal.sns_source_unmapped from anon, authenticated;
grant select, insert, update, delete on internal.sns_source_unmapped to batch_writer;
create policy batch_writer_all on internal.sns_source_unmapped for all to batch_writer using (true) with check (true);
