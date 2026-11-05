"""集計、伏せ値、派生指標（03 §6、02 §3、05 §4.1）。外部に触れない純粋な計算。

生値はここまでで、結果の行には伏せた後の値だけを入れる（02 §1）。
合計・累積は伏せる前の値から計算する。分布と帯は計算しない（公開ビューが計算する。02 §4.1）。
"""

import statistics
from collections import Counter, defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal
from typing import Any, Final

from takatsu_batch.config import (
    BACKFILL_START,
    CHANNEL_BUCKETS,
    DEVICE_BUCKETS,
    EVERGREEN_MIN_DAYS_SINCE_PUBLISH,
    HEATMAP_BUCKETS,
    LOCAL_BUCKETS,
    LONG_MIN_DAYS_SINCE_PUBLISH,
    MASK_THRESHOLD,
    MILESTONES,
    NEW_MAX_DAYS_SINCE_PUBLISH,
    NEW_RETURNING_BUCKETS,
    OWN_MEDIAN_MIN_POSTS,
    RECENT_HOT_MIN_DAYS_SINCE_PUBLISH,
    RECENT_HOT_MIN_PV_7D,
    SNS_BUCKETS,
    TOP_N_CITY,
    TOP_N_REFERRER_ARTICLE,
    TOP_N_REFERRER_SITE,
    FreshnessBucket,
)
from takatsu_batch.db import DeriveInputs, PostRow, PriorState
from takatsu_batch.ga4_daily import DailyRaw
from takatsu_batch.ga4_period import PeriodFetch, PeriodRaw
from takatsu_batch.mask import (
    MaskedCell,
    apply_author_hierarchy_mask,
    mask_exclusive,
    mask_value,
    top_n_above_threshold,
)
from takatsu_batch.period import Period, PeriodPlan
from takatsu_batch.wp_fetch import WpResult

type DbRow = tuple[Any, ...]

_MAX_CUMULATIVE_DAYS: Final = 90
_OWN_MEDIAN_WINDOW_DAYS: Final = 365
_RECENT_DAYS: Final = 7
_PRIOR_DAYS: Final = 28
_EVERGREEN_WINDOW_DAYS: Final = 28
_PV_7D_N: Final = 7
_PV_30D_N: Final = 30
_RECENT_HOT_RATIO: Final = 2


@dataclass(slots=True)
class DeriveOutput:
    """write 工程が書く行。列の順は write.py の定義に合わせる。"""

    wp: WpResult
    period_rows: list[DbRow] = field(default_factory=list)
    site_daily: list[DbRow] = field(default_factory=list)
    site_daily_channel: list[DbRow] = field(default_factory=list)
    site_daily_device: list[DbRow] = field(default_factory=list)
    article_daily: list[DbRow] = field(default_factory=list)
    article_daily_scope_days: list[date] = field(default_factory=list)
    site_period: list[DbRow] = field(default_factory=list)
    site_period_breakdown: list[DbRow] = field(default_factory=list)
    site_period_heatmap: list[DbRow] = field(default_factory=list)
    article_period: list[DbRow] = field(default_factory=list)
    article_period_breakdown: list[DbRow] = field(default_factory=list)
    author_period_breakdown: list[DbRow] = field(default_factory=list)
    refetched_period_ids: list[str] = field(default_factory=list)
    site_month_referrer: list[DbRow] = field(default_factory=list)
    referrer_scope_months: list[str] = field(default_factory=list)
    site_month_city: list[DbRow] = field(default_factory=list)
    city_scope_months: list[str] = field(default_factory=list)
    article_referrer_30d: list[DbRow] = field(default_factory=list)
    referrer_scope_posts: list[int] = field(default_factory=list)
    article_summary: list[DbRow] = field(default_factory=list)
    article_milestone: list[DbRow] = field(default_factory=list)
    author_summary: list[DbRow] = field(default_factory=list)
    sns_source_unmapped: list[DbRow] = field(default_factory=list)


def _published_daily(
    daily: Mapping[date, int], published_on: date, base_date: date
) -> dict[date, int]:
    """公開日から基準日までの日別。公開前の日（プレビューなど）を含めない。"""
    return {day: pv for day, pv in daily.items() if published_on <= day <= base_date}


def cumulative(daily: Mapping[date, int], published_on: date, base_date: date) -> list[int]:
    """M-18。公開日を 1 日目とする累積（添字 0 が 1 日目）。最大 90 日。欠けた日は 0。"""
    days = min((base_date - published_on).days + 1, _MAX_CUMULATIVE_DAYS)
    total = 0
    result: list[int] = []
    for offset in range(days):
        total += daily.get(published_on + timedelta(days=offset), 0)
        result.append(total)
    return result


def freshness(days_since_publish: int) -> FreshnessBucket:
    """M-21。基準日 − 公開日 で判定する（age_days ではない）。"""
    if days_since_publish <= NEW_MAX_DAYS_SINCE_PUBLISH:
        return "new"
    return "long" if days_since_publish >= LONG_MIN_DAYS_SINCE_PUBLISH else "mid"


def is_recent_hot(days_since_publish: int, pv_recent_7d: int, pv_prior_28d: int) -> bool:
    """M-22。直近 7 日 ≥ 2 × (前 28 日 ÷ 4)。小数を避けて 2 × 直近 7 日 ≥ 前 28 日 で比べる。"""
    return (
        days_since_publish >= RECENT_HOT_MIN_DAYS_SINCE_PUBLISH
        and pv_recent_7d >= RECENT_HOT_MIN_PV_7D
        and _RECENT_HOT_RATIO * pv_recent_7d >= pv_prior_28d
    )


def is_revival(days_since_publish: int, recent_hot: bool) -> bool:
    return recent_hot and days_since_publish >= LONG_MIN_DAYS_SINCE_PUBLISH


def is_evergreen_365(days_since_publish: int, pv_recent_28d: int) -> bool:
    """M-23。"""
    return (
        days_since_publish >= EVERGREEN_MIN_DAYS_SINCE_PUBLISH
        and pv_recent_28d >= RECENT_HOT_MIN_PV_7D
    )


def milestones(daily: Mapping[date, int]) -> dict[int, date]:
    """M-23。累積が節目以上になった最初の日。同じ日に 2 つ超えたら両方。"""
    reached: dict[int, date] = {}
    total = 0
    for day in sorted(daily):
        total += daily[day]
        for milestone in MILESTONES:
            if milestone not in reached and total >= milestone:
                reached[milestone] = day
    return reached


def own_median_30d(values: Sequence[int]) -> Decimal | None:
    """M-24。該当が 5 本未満なら None。偶数本では .5 になる。"""
    if len(values) < OWN_MEDIAN_MIN_POSTS:
        return None
    return Decimal(str(statistics.median(values)))


def _masked_rows(
    raw: Mapping[Any, int], buckets: Sequence[Any], prefix: tuple[Any, ...]
) -> list[DbRow]:
    """区分のすべてのセルに手順 1〜3 を適用し、前置き + バケット + 値 + mask の行にする。

    曜日 × 時間帯のバケットはタプルなので、列 2 つに展開する。
    """
    rows: list[DbRow] = []
    for cell in mask_exclusive(raw, buckets, MASK_THRESHOLD):
        bucket = cell.bucket if isinstance(cell.bucket, tuple) else (cell.bucket,)
        rows.append((*prefix, *bucket, cell.value, cell.mask))
    return rows


def _derive_daily(raw: DailyRaw, output: DeriveOutput) -> None:
    days = sorted(raw.site.keys() | raw.channel.keys() | raw.device_pv.keys())
    output.site_daily = [(day, *raw.site[day]) for day in sorted(raw.site)]
    for day in days:
        output.site_daily_channel.extend(
            _masked_rows(raw.channel.get(day, Counter()), CHANNEL_BUCKETS, (day,))
        )
        pv_cells = mask_exclusive(raw.device_pv.get(day, Counter()), DEVICE_BUCKETS, MASK_THRESHOLD)
        session_cells = mask_exclusive(
            raw.device_sessions.get(day, Counter()), DEVICE_BUCKETS, MASK_THRESHOLD
        )
        output.site_daily_device.extend(
            (day, pv.bucket, pv.value, pv.mask, sessions.value, sessions.mask)
            for pv, sessions in zip(pv_cells, session_cells, strict=True)
        )
    output.article_daily = [
        (post_id, day, pageviews) for (post_id, day), pageviews in sorted(raw.article.items())
    ]
    output.article_daily_scope_days = sorted(raw.site)


def _merged_article_daily(
    stored: Mapping[tuple[int, date], int], raw: DailyRaw, posts: Mapping[int, PostRow]
) -> dict[int, dict[date, int]]:
    """内部表の値に今回の取得を重ねる。取り直した日は今回の値だけを正とする。"""
    refetched_days = set(raw.site)
    merged: defaultdict[int, dict[date, int]] = defaultdict(dict)
    for (post_id, day), pageviews in stored.items():
        if post_id in posts and day not in refetched_days:
            merged[post_id][day] = pageviews
    for (post_id, day), pageviews in raw.article.items():
        merged[post_id][day] = pageviews
    return merged


def _period_pageviews(daily: Mapping[date, int], period: Period) -> int:
    return sum(pv for day, pv in daily.items() if period.start_date <= day <= period.end_date)


def _derive_site_period(period_id: str, raw: PeriodRaw, output: DeriveOutput) -> None:
    active = mask_value("active_users", raw.active_users, MASK_THRESHOLD)
    output.site_period.append((period_id, raw.engagement_seconds, active.value, active.mask))
    for axis, values, buckets in (
        ("sns", raw.sns, SNS_BUCKETS),
        ("new_returning", raw.new_returning, NEW_RETURNING_BUCKETS),
        ("local", raw.local, LOCAL_BUCKETS),
        ("channel", raw.channel, CHANNEL_BUCKETS),
        ("device_pv", raw.device_pv, DEVICE_BUCKETS),
        ("device_sessions", raw.device_sessions, DEVICE_BUCKETS),
    ):
        output.site_period_breakdown.extend(_masked_rows(values, buckets, (period_id, axis)))
    valid_cells = {cell: raw.heatmap[cell] for cell in HEATMAP_BUCKETS if cell in raw.heatmap}
    output.site_period_heatmap.extend(_masked_rows(valid_cells, HEATMAP_BUCKETS, (period_id,)))


def _derive_article_period(
    period: Period,
    raw: PeriodRaw,
    posts: Mapping[int, PostRow],
    daily: Mapping[int, Mapping[date, int]],
    output: DeriveOutput,
) -> None:
    """記事 × 期間の行は全公開記事の分を作る（02 §4 の行の範囲）。GA4 に行がなければ 0。"""
    for post_id in sorted(posts):
        landing = mask_value("landing", raw.landing_sessions[post_id], MASK_THRESHOLD)
        scroll = mask_value("scroll", raw.scroll_by_post[post_id], MASK_THRESHOLD)
        engagement = mask_value("engagement", raw.engagement_by_post[post_id], MASK_THRESHOLD)
        output.article_period.append(
            (
                post_id,
                period.period_id,
                _period_pageviews(daily.get(post_id, {}), period),
                landing.value,
                landing.mask,
                scroll.value,
                scroll.mask,
                engagement.value,
                engagement.mask,
            )
        )


def _empty_article_period_rows(
    plan: PeriodPlan,
    posts: Mapping[int, PostRow],
    daily: Mapping[int, Mapping[date, int]],
    existing: frozenset[tuple[int, str]],
) -> list[DbRow]:
    """取り直さない確定月に、行のない記事（新しい記事）の行を 0 で足す。GA4 には問い合わせない。"""
    refetched = {period.period_id for period in plan.refetch}
    return [
        (
            post_id,
            period.period_id,
            _period_pageviews(daily.get(post_id, {}), period),
            0,
            None,
            0,
            None,
            0,
            None,
        )
        for period in plan.all_periods
        if period.period_id not in refetched
        for post_id in sorted(posts)
        if (post_id, period.period_id) not in existing
    ]


def _derive_breakdowns(
    period_id: str, raw: PeriodRaw, posts: Mapping[int, PostRow], output: DeriveOutput
) -> None:
    """記事 × 内訳軸に手順 1〜3、著者 × 内訳軸に合算 → 手順 1〜3 → 手順 5（03 §6.1）。"""
    post_ids = sorted(posts)
    for axis, values, buckets in (
        ("channel", raw.article_channel, CHANNEL_BUCKETS),
        ("sns", raw.article_sns, SNS_BUCKETS),
        ("device", raw.article_device, DEVICE_BUCKETS),
    ):
        article_cells: dict[int, list[MaskedCell[Any]]] = {
            post_id: mask_exclusive(values.get(post_id, Counter()), buckets, MASK_THRESHOLD)
            for post_id in post_ids
        }
        output.article_period_breakdown.extend(
            (post_id, period_id, axis, cell.bucket, cell.value, cell.mask)
            for post_id, cells in article_cells.items()
            for cell in cells
        )
        if axis != "device":  # 著者 × デバイスは格納しない（05 §4.1）
            _derive_author_axis(period_id, axis, values, buckets, article_cells, posts, output)


def _derive_author_axis(
    period_id: str,
    axis: str,
    values: Mapping[int, Mapping[Any, int]],
    buckets: Sequence[Any],
    article_cells: Mapping[int, Sequence[MaskedCell[Any]]],
    posts: Mapping[int, PostRow],
    output: DeriveOutput,
) -> None:
    post_ids_by_author: defaultdict[str, list[int]] = defaultdict(list)
    for post_id in sorted(posts):
        post_ids_by_author[posts[post_id].author_slug].append(post_id)
    for author_slug in sorted(post_ids_by_author):
        post_ids = post_ids_by_author[author_slug]
        totals: Counter[Any] = Counter()
        for post_id in post_ids:
            totals.update(values.get(post_id, {}))
        cells = apply_author_hierarchy_mask(
            mask_exclusive(totals, buckets, MASK_THRESHOLD),
            [article_cells[post_id] for post_id in post_ids],
            MASK_THRESHOLD,
        )
        output.author_period_breakdown.extend(
            (author_slug, period_id, axis, cell.bucket, cell.value, cell.mask) for cell in cells
        )


def _ranked(values: Mapping[Any, int], n: int) -> list[Any]:
    """T 未満を落として多い順に N 件。同値は名前の順で固定する（再実行で順が揺れない）。"""
    return top_n_above_threshold(sorted(values), values.__getitem__, n, MASK_THRESHOLD)


def _derive_month_rows(plan: PeriodPlan, fetched: PeriodFetch, output: DeriveOutput) -> None:
    for period_id, referrers in fetched.month_referrers.items():
        output.referrer_scope_months.append(period_id)
        for rank, source in enumerate(_ranked(referrers, TOP_N_REFERRER_SITE), start=1):
            output.site_month_referrer.append((period_id, rank, source, referrers[source]))
    for month in plan.city_months:
        period_id = month.period_id
        if period_id in fetched.extra_cities:
            cities = fetched.extra_cities[period_id]
        elif period_id in fetched.periods:
            cities = fetched.periods[period_id].cities
        else:
            continue
        output.city_scope_months.append(period_id)
        for rank, place in enumerate(_ranked(cities, TOP_N_CITY), start=1):
            region, city = place
            output.site_month_city.append((period_id, rank, "Japan", region, city, cities[place]))


def _derive_article_referrers(fetched: PeriodFetch, base_date: date, output: DeriveOutput) -> None:
    for post_id, referrers in sorted(fetched.article_referrers.items()):
        output.referrer_scope_posts.append(post_id)
        for rank, source in enumerate(_ranked(referrers, TOP_N_REFERRER_ARTICLE), start=1):
            output.article_referrer_30d.append(
                (post_id, rank, source, referrers[source], base_date)
            )


def _window_sum(daily: Mapping[date, int], last_day: date, days: int) -> int:
    first_day = last_day - timedelta(days=days - 1)
    return sum(pv for day, pv in daily.items() if first_day <= day <= last_day)


def _derive_summaries(
    posts: Mapping[int, PostRow],
    daily: Mapping[int, Mapping[date, int]],
    referrer_computed: Mapping[int, date],
    base_date: date,
    output: DeriveOutput,
) -> None:
    measurement_start = date.fromisoformat(BACKFILL_START)
    own_cutoff = base_date - timedelta(days=_OWN_MEDIAN_WINDOW_DAYS)
    own_values: defaultdict[str, list[int]] = defaultdict(list)
    author_slugs = {post.author_slug for post in posts.values()}
    for post_id in sorted(posts):
        post = posts[post_id]
        since_publish = (base_date - post.published_on).days
        age_days = since_publish + 1
        published = _published_daily(daily.get(post_id, {}), post.published_on, base_date)
        curve = cumulative(published, post.published_on, base_date)
        # 計測開始より前に公開した記事は累積が欠けるので、7 日と 30 日の値を持たない（02 §4.1）
        measured = post.published_on >= measurement_start
        pv_7d = curve[_PV_7D_N - 1] if measured and age_days >= _PV_7D_N else None
        pv_30d = curve[_PV_30D_N - 1] if measured and age_days >= _PV_30D_N else None
        recent_7d = _window_sum(published, base_date, _RECENT_DAYS)
        prior_28d = _window_sum(published, base_date - timedelta(days=_RECENT_DAYS), _PRIOR_DAYS)
        hot = is_recent_hot(since_publish, recent_7d, prior_28d)
        output.article_summary.append(
            (
                post_id,
                base_date,
                age_days,
                freshness(since_publish),
                pv_7d,
                pv_30d,
                sum(published.values()),
                hot,
                is_revival(since_publish, hot),
                is_evergreen_365(
                    since_publish, _window_sum(published, base_date, _EVERGREEN_WINDOW_DAYS)
                ),
                referrer_computed.get(post_id),
            )
        )
        output.article_milestone.extend(
            (post_id, milestone, reached)
            for milestone, reached in sorted(milestones(published).items())
        )
        if pv_30d is not None and post.published_on >= own_cutoff:
            own_values[post.author_slug].append(pv_30d)
    for author_slug in sorted(author_slugs):
        values = own_values.get(author_slug, [])
        output.author_summary.append((author_slug, base_date, own_median_30d(values), len(values)))


def _derive_unmapped(
    periods: Iterable[Period], fetched: PeriodFetch, base_date: date, output: DeriveOutput
) -> None:
    """基準日で終わる期間（直近の移動窓と当月）に現れた参照元だけを残す。

    last_seen_on を基準日にするので、過去の期間にだけ現れたものは入れない。
    last_sessions は、取り直す期間の順で最初に見つかった期間の値（狭い窓が先）。
    """
    sessions_by_source: dict[str, int] = {}
    for period in periods:
        if period.end_date != base_date:
            continue
        for source, sessions in fetched.periods[period.period_id].unmapped_sources.items():
            sessions_by_source.setdefault(source, sessions)
    output.sns_source_unmapped = [
        (source, base_date, base_date, sessions)
        for source, sessions in sorted(sessions_by_source.items())
    ]


def derive(
    wp: WpResult,
    plan: PeriodPlan,
    daily: DailyRaw,
    fetched: PeriodFetch,
    inputs: DeriveInputs,
    prior: PriorState,
    base_date: date,
) -> DeriveOutput:
    output = DeriveOutput(wp=wp)
    output.period_rows = [
        (p.period_id, p.kind, p.start_date, p.end_date, base_date, p.is_confirmed)
        for p in plan.refetch
    ]
    output.refetched_period_ids = [p.period_id for p in plan.refetch]
    # 集計は基準日までに公開された記事だけ。基準日を過去にした実行で、後の記事を数えないため
    posts = wp.measurable_posts(base_date)
    _derive_daily(daily, output)
    merged = _merged_article_daily(inputs.article_daily, daily, posts)
    for period in plan.refetch:
        raw = fetched.periods[period.period_id]
        _derive_site_period(period.period_id, raw, output)
        _derive_article_period(period, raw, posts, merged, output)
        _derive_breakdowns(period.period_id, raw, posts, output)
    output.article_period.extend(
        _empty_article_period_rows(plan, posts, merged, inputs.article_period_keys)
    )
    _derive_month_rows(plan, fetched, output)
    _derive_article_referrers(fetched, base_date, output)
    computed = dict(prior.referrer_computed)
    computed.update(dict.fromkeys(fetched.article_referrers, base_date))
    _derive_summaries(posts, merged, computed, base_date, output)
    _derive_unmapped(plan.refetch, fetched, base_date, output)
    return output
