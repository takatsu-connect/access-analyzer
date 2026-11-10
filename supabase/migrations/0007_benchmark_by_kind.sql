-- 記事の分布（M-19、「多くの記事はこの範囲」）を記事の種類で分ける（2026-11-10 の依頼者の決定）。
-- 種類は親カテゴリで決める。親 10（設定値 ARTICLE_CATEGORY_ID）またはその子に属すれば「記事」、
-- 親 9（設定値 EVENT_CATEGORY_ID）またはその子に属すれば「イベント」。両方に属する記事は両方に入り、
-- どちらにも属さない記事はどちらにも入らない。親カテゴリに直接付いた記事も親の ID で判定する。
-- SQL の 10 と 9 は設定値とテストで突き合わせる（07 I-DB-05 の要領）。
-- - internal.article_cumulative: 記事の親カテゴリの ID の配列（parent_category_ids）を末尾に足す。
-- - internal.benchmark_curve: scope 'kind:article' と 'kind:event' を足す。'all' と 'cat:<子>' は変えない。
-- - public.pub_article_summary: band_7d と band_30d を、記事の主な種類の曲線と比べる
--   （記事に属せば 'kind:article'、そうでなくイベントに属せば 'kind:event'、どちらでもなければ 'all'）。
-- pub_benchmark_curve は scope を絞らずに出しているので、そのまま新しい scope も出る。
-- pub_author_summary は 'all' と比べたまま変えない。
-- どれも create or replace view で、列の名前・型・順を変えない（article_cumulative は末尾に足すだけ）。
-- 既存の権限はそのまま残り、表・ロール・権限は増やさない。公開ビューの列も変わらない。
-- 内部表は変えないので、この適用の前に動いていたバッチの書き込みもそのまま通る。

-- n 日目の累積（M-18）。0005 の定義に parent_category_ids を足しただけ
create or replace view internal.article_cumulative as
select
  ps.post_id,
  g.n,
  (sum(coalesce(d.pageviews, 0)) over (partition by ps.post_id order by g.n))::integer as cumulative_pv,
  -- 下のビューが窓関数の結果へ join し直さずに済むよう、母集団の判定に使う列も出す（公開ビューには出さない）
  ps.age_days,
  ps.base_date,
  ps.published_on,
  ps.is_ad,
  ps.child_category_ids,
  ps.parent_category_ids
from (
  -- offset 0 で、記事の単位の結合とカテゴリの対応を先に確定させる。統計が「0 行」のとき
  -- （書き込みの直後など）に、記事の数だけ generate_series を総当たりしたり、累積の 1 行ごとに
  -- カテゴリの表を引いたりする実行計画になり、桁違いに遅くなるため
  select
    p.post_id,
    p.published_on,
    p.is_ad,
    s.age_days,
    s.base_date,
    array(
      select cat.category_id
      from internal.wp_post_category pc
      join internal.wp_category cat on cat.category_id = pc.category_id and cat.parent_id is not null
      where pc.post_id = p.post_id
    ) as child_category_ids,
    -- 所属カテゴリの親の ID（親に直接付いていれば自身の ID）。カテゴリは二階層
    array(
      select distinct coalesce(cat.parent_id, cat.category_id)
      from internal.wp_post_category pc
      join internal.wp_category cat on cat.category_id = pc.category_id
      where pc.post_id = p.post_id
      order by 1
    ) as parent_category_ids
  from internal.wp_post p
  join internal.article_summary s on s.post_id = p.post_id
  offset 0
) as ps
cross join lateral generate_series(1, least(ps.age_days, 90)) as g (n)
left join internal.article_daily d
  on d.post_id = ps.post_id
  and d.day = ps.published_on + (g.n - 1);

-- 記事の分布（M-19、M-27）。母集団は広告を除く公開記事で、age_days >= n は累積の行の有無で満たす。
-- 下の 30 は設定値 BENCHMARK_MIN_POPULATION（07 I-DB-17 で一致を確かめる）。
-- date '2025-10-08' は設定値 BACKFILL_START。これより前に公開した記事は初日からの日別がそろわないので除く（02 §4.1）。
-- 10 は設定値 ARTICLE_CATEGORY_ID、9 は EVENT_CATEGORY_ID（07 I-DB-05 の要領で一致を確かめる）。
create or replace view internal.benchmark_curve as
-- materialized: 統計が古いと窓関数の結果を行ごとに計算し直す実行計画になり、桁違いに遅くなるため
with cumulative as materialized (
  select
    post_id,
    n,
    cumulative_pv,
    published_on >= base_date - 365 as in_12m,
    base_date,
    child_category_ids,
    parent_category_ids
  from internal.article_cumulative
  where not is_ad and published_on >= date '2025-10-08'
),
population as (
  select 'all'::text as scope, c.n, c.cumulative_pv, c.in_12m, c.base_date
  from cumulative c
  union all
  -- 子カテゴリは累積のビューが記事の単位で引いた配列を開くだけにする（ここでは表を引かない）
  select 'cat:' || child.category_id::text, c.n, c.cumulative_pv, c.in_12m, c.base_date
  from cumulative c
  cross join lateral unnest(c.child_category_ids) as child (category_id)
  union all
  -- 記事の種類。両方に属する記事は両方の母集団に入る
  select 'kind:article', c.n, c.cumulative_pv, c.in_12m, c.base_date
  from cumulative c
  where 10 = any (c.parent_category_ids)
  union all
  select 'kind:event', c.n, c.cumulative_pv, c.in_12m, c.base_date
  from cumulative c
  where 9 = any (c.parent_category_ids)
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

-- 帯は記事の主な種類の曲線 (scope, n) と比べる。p25 / p75 と等しいときは middle（03 §6.2）。
-- 主な種類: 記事（10）に属せば kind:article、そうでなくイベント（9）に属せば kind:event、
-- どちらでもなければ all。主な種類の曲線に行がなければ帯は null（all に戻さない）。
-- materialized と集約: 統計が古いときに窓関数や分位の計算を行ごとにやり直さないようにする
create or replace view public.pub_article_summary as
with cumulative as materialized (
  select
    c.post_id,
    case
      when 10 = any (c.parent_category_ids) then 'kind:article'
      when 9 = any (c.parent_category_ids) then 'kind:event'
      else 'all'
    end as scope,
    max(c.cumulative_pv) filter (where c.n = 7) as pv_at_7,
    max(c.cumulative_pv) filter (where c.n = least(c.age_days, 30)) as pv_at_30
  from internal.article_cumulative c
  where c.n <= 30
  group by c.post_id, c.parent_category_ids
),
curve as materialized (
  select scope, n, p25, p75
  from internal.benchmark_curve
  where scope in ('all', 'kind:article', 'kind:event')
)
select
  s.post_id,
  s.age_days,
  s.freshness,
  -- date '2025-10-08' は設定値 BACKFILL_START。これより前に公開した記事は累積が欠けるので 7 日、30 日、帯を出さない
  case when p.published_on >= date '2025-10-08' then s.pv_7d end as pv_7d,
  case when p.published_on >= date '2025-10-08' then s.pv_30d end as pv_30d,
  s.pv_total,
  case
    when p.published_on < date '2025-10-08' then null
    when s.age_days < 7 or c.pv_at_7 is null or b7.n is null then null
    when c.pv_at_7 > b7.p75 then 'upper'
    when c.pv_at_7 < b7.p25 then 'lower'
    else 'middle'
  end as band_7d,
  case
    when p.published_on < date '2025-10-08' then null
    when s.age_days < 3 or c.pv_at_30 is null or b30.n is null then null
    when c.pv_at_30 > b30.p75 then 'upper'
    when c.pv_at_30 < b30.p25 then 'lower'
    else 'middle'
  end as band_30d,
  s.is_recent_hot,
  s.is_revival,
  s.is_evergreen_365,
  s.referrer_30d_computed_on
from internal.article_summary s
join internal.wp_post p on p.post_id = s.post_id
left join cumulative c on c.post_id = s.post_id
left join curve b7 on b7.scope = c.scope and b7.n = 7
left join curve b30 on b30.scope = c.scope and b30.n = least(s.age_days, 30);
