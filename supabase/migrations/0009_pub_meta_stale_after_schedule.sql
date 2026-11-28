-- pub_meta.is_stale を、日次バッチの定刻を基準にした判定に直す（FR-02、NFR-90）。
--
-- 0005 の定義は「基準日 < 今日（JST）- 1」だった。日次バッチは JST 17:00 に前日を基準日として動くので、
-- 日付が変わってからその日のバッチが終わるまで（0 時〜17 時すぎ）は、正常でも基準日が 2 日前になり、
-- その間に BI を再ビルドすると、全ページに「更新が遅れています」が焼き込まれた。
--
-- 新しい定義: 定刻（JST 17:00）から 14 時間たっても、その回のぶんの成功がないとき。
-- 時刻 t（JST）に成功しているはずの基準日は、(t - 17 時間 - 14 時間) の日付 - 1。
-- 14 時間は、GitHub Actions の定期実行の遅れ（本番の実測で最大 12 時間ほど）と実行時間の余裕。
-- 成功した実行が 1 つもないときは、これまでどおり true。列と権限は変えない。
create or replace view public.pub_meta as
select
  last_success.base_date,
  last_success.finished_at,
  last_success.mask_threshold,
  coalesce(
    last_success.base_date
      < ((now() at time zone 'Asia/Tokyo') - interval '31 hours')::date - 1,
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
