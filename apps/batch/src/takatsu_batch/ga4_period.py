"""期間別の取得（03 §1 工程 4、§5.3、§5.4）。生値はメモリにだけ持つ（02 §1）。"""

from collections import Counter, defaultdict
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Final

from takatsu_batch.channel import map_channel
from takatsu_batch.config import (
    BACKFILL_START,
    CONFIRM_DELAY_DAYS,
    GA4_RANGES_PER_REQUEST,
    ChannelBucket,
    DeviceBucket,
    LocalBucket,
    NewReturningBucket,
    SnsBucket,
)
from takatsu_batch.db import PostRow
from takatsu_batch.ga4_client import CHANNEL_DIMENSION, Ga4Client, NamedRange, Row
from takatsu_batch.ga4_daily import to_device_bucket
from takatsu_batch.log import log_count
from takatsu_batch.page_path import extract_post_id
from takatsu_batch.period import Period, PeriodPlan, chunked
from takatsu_batch.sns_source import normalize_sns_source, to_sns_bucket

_JAPAN: Final = "Japan"
_KAWASAKI: Final = "Kawasaki"
_NOT_SET: Final = frozenset({"", "(not set)"})
# 公開日を 1 日目とした 30 日目までと、遅延の反映を待つ日数（03 §3）
_REFERRER_WINDOW_LAST_OFFSET: Final = 29


@dataclass(slots=True)
class PeriodRaw:
    """1 期間の生値。"""

    active_users: int = 0
    engagement_seconds: int = 0
    new_returning: Counter[NewReturningBucket] = field(default_factory=Counter)
    sns: Counter[SnsBucket] = field(default_factory=Counter)
    unmapped_sources: Counter[str] = field(default_factory=Counter)
    heatmap: Counter[tuple[int, int]] = field(default_factory=Counter)
    local: Counter[LocalBucket] = field(default_factory=Counter)
    cities: Counter[tuple[str, str]] = field(default_factory=Counter)
    channel: Counter[ChannelBucket] = field(default_factory=Counter)
    device_pv: Counter[DeviceBucket] = field(default_factory=Counter)
    device_sessions: Counter[DeviceBucket] = field(default_factory=Counter)
    landing_sessions: Counter[int] = field(default_factory=Counter)
    engagement_by_post: Counter[int] = field(default_factory=Counter)
    scroll_by_post: Counter[int] = field(default_factory=Counter)
    article_channel: defaultdict[int, Counter[ChannelBucket]] = field(
        default_factory=lambda: defaultdict(Counter)
    )
    article_sns: defaultdict[int, Counter[SnsBucket]] = field(
        default_factory=lambda: defaultdict(Counter)
    )
    article_device: defaultdict[int, Counter[DeviceBucket]] = field(
        default_factory=lambda: defaultdict(Counter)
    )


@dataclass(slots=True)
class PeriodFetch:
    periods: dict[str, PeriodRaw] = field(default_factory=dict)
    # 市別だけを取り直した確定月（§3 の補い）
    extra_cities: dict[str, Counter[tuple[str, str]]] = field(default_factory=dict)
    # 確定月の参照元ドメイン（G16）
    month_referrers: dict[str, Counter[str]] = field(default_factory=dict)
    # 今回計算した記事の参照元（G17）
    article_referrers: dict[int, Counter[str]] = field(default_factory=dict)


def to_new_returning(value: str) -> NewReturningBucket:
    """new / returning 以外（空、(not set)）は unknown（03 §5.3）。"""
    if value == "new":
        return "new"
    return "returning" if value == "returning" else "unknown"


def classify_local(country: str, city: str) -> LocalBucket:
    """地元の読者の目安の 3 区分（03 §5.4）。国外と不明はどちらも unknown。"""
    if country != _JAPAN or city in _NOT_SET:
        return "unknown"
    return "kawasaki" if city == _KAWASAKI else "japan_other"


def normalize_referrer(source: str) -> str | None:
    """参照元ドメイン。小文字にそろえて合算する。値のないものは数えない。"""
    value = source.strip().lower()
    return None if value in _NOT_SET or value == "(direct)" else value


def _as_ranges(periods: Sequence[Period]) -> list[NamedRange]:
    return [NamedRange(p.period_id, p.start_date, p.end_date) for p in periods]


def _known_post(raw_path: str, known: Collection[int]) -> int | None:
    """記事 ID に正規化する。`/4812` と `/4812/` は同じ ID になり、呼び出し側で合算される。"""
    post_id = extract_post_id(raw_path)
    return post_id if post_id is not None and post_id in known else None


def _collect_cities(rows: Sequence[Row], target: Counter[tuple[str, str]]) -> None:
    for row in rows:
        region, city = row.dimensions["region"], row.dimensions["city"]
        if row.dimensions["country"] == _JAPAN and region not in _NOT_SET and city not in _NOT_SET:
            target[(region, city)] += row.metric_int("sessions")


def _fetch_site_axes(
    client: Ga4Client, ranges: Sequence[NamedRange], out: dict[str, PeriodRaw]
) -> None:
    for row in client.report("G5", ranges):
        raw = out[row.range_name]
        raw.active_users += row.metric_int("activeUsers")
        raw.engagement_seconds += row.metric_int("userEngagementDuration")
    for row in client.report("G6", ranges):
        bucket = to_new_returning(row.dimensions["newVsReturning"])
        out[row.range_name].new_returning[bucket] += row.metric_int("activeUsers")
    for row in client.report("G7", ranges):
        raw = out[row.range_name]
        source = row.dimensions["sessionSource"]
        result = normalize_sns_source(source)
        sessions = row.metric_int("sessions")
        raw.sns[to_sns_bucket(result)] += sessions
        if result == "unmapped":
            raw.unmapped_sources[source.strip().lower()] += sessions
    for row in client.report("G8", ranges):
        dow, hour = row.dimensions["dayOfWeek"], row.dimensions["hour"]
        # 数字でない値（(other) など）は数えない。168 セルの外の値は derive が落とす
        if dow.isascii() and dow.isdigit() and hour.isascii() and hour.isdigit():
            out[row.range_name].heatmap[(int(dow), int(hour))] += row.metric_int("screenPageViews")
    for row in client.report("G9", ranges):
        raw = out[row.range_name]
        bucket_local = classify_local(row.dimensions["country"], row.dimensions["city"])
        raw.local[bucket_local] += row.metric_int("sessions")
        _collect_cities([row], raw.cities)
    for row in client.report("G19", ranges):
        channel = map_channel(row.dimensions[CHANNEL_DIMENSION])
        out[row.range_name].channel[channel] += row.metric_int("sessions")
    for row in client.report("G20", ranges):
        device = to_device_bucket(row.dimensions["deviceCategory"])
        if device is None:
            client.usage.unknown_device_rows += 1
            continue
        out[row.range_name].device_pv[device] += row.metric_int("screenPageViews")
        out[row.range_name].device_sessions[device] += row.metric_int("sessions")


def _fetch_article_axes(
    client: Ga4Client,
    ranges: Sequence[NamedRange],
    known: Collection[int],
    out: dict[str, PeriodRaw],
) -> None:
    for row in client.report("G10", ranges):
        post_id = _known_post(row.dimensions["landingPage"], known)
        if post_id is not None:
            out[row.range_name].landing_sessions[post_id] += row.metric_int("sessions")
    for row in client.report("G11", ranges):
        post_id = _known_post(row.dimensions["pagePath"], known)
        if post_id is not None:
            out[row.range_name].engagement_by_post[post_id] += row.metric_int(
                "userEngagementDuration"
            )
    for row in client.report("G12", ranges):
        post_id = _known_post(row.dimensions["pagePath"], known)
        if post_id is not None:
            out[row.range_name].scroll_by_post[post_id] += row.metric_int("eventCount")
    for row in client.report("G13", ranges):
        post_id = _known_post(row.dimensions["landingPage"], known)
        if post_id is not None:
            channel = map_channel(row.dimensions[CHANNEL_DIMENSION])
            out[row.range_name].article_channel[post_id][channel] += row.metric_int("sessions")
    for row in client.report("G14", ranges):
        post_id = _known_post(row.dimensions["landingPage"], known)
        if post_id is not None:
            bucket = to_sns_bucket(normalize_sns_source(row.dimensions["sessionSource"]))
            out[row.range_name].article_sns[post_id][bucket] += row.metric_int("sessions")
    for row in client.report("G15", ranges):
        device = to_device_bucket(row.dimensions["deviceCategory"])
        if device is None:
            client.usage.unknown_device_rows += 1
            continue
        post_id = _known_post(row.dimensions["landingPage"], known)
        if post_id is not None:
            out[row.range_name].article_device[post_id][device] += row.metric_int("sessions")


def referrer_due(published_on: date, base_date: date) -> bool:
    """公開後 30 日の窓が終わり、遅延の反映を待ち終えたか（03 §3）。"""
    delay = timedelta(days=_REFERRER_WINDOW_LAST_OFFSET + CONFIRM_DELAY_DAYS)
    return published_on + delay <= base_date


def fetch(
    client: Ga4Client,
    plan: PeriodPlan,
    posts: Mapping[int, PostRow],
    referrer_computed: Mapping[int, date],
    base_date: date,
    *,
    full: bool,
) -> PeriodFetch:
    known = frozenset(posts)
    result = PeriodFetch(periods={p.period_id: PeriodRaw() for p in plan.refetch})
    for periods in chunked(plan.refetch, GA4_RANGES_PER_REQUEST):
        ranges = _as_ranges(periods)
        _fetch_site_axes(client, ranges, result.periods)
        _fetch_article_axes(client, ranges, known, result.periods)
    for periods in chunked(plan.city_extra_months, GA4_RANGES_PER_REQUEST):
        rows = client.report("G9", _as_ranges(periods))
        for period in periods:
            cities: Counter[tuple[str, str]] = Counter()
            _collect_cities([row for row in rows if row.range_name == period.period_id], cities)
            result.extra_cities[period.period_id] = cities
    for month in plan.referrer_months:
        referrers: Counter[str] = Counter()
        for row in client.report("G16", _as_ranges([month])):
            source = normalize_referrer(row.dimensions["sessionSource"])
            if source is not None:
                referrers[source] += row.metric_int("sessions")
        result.month_referrers[month.period_id] = referrers
    measurement_start = date.fromisoformat(BACKFILL_START)
    for post_id in sorted(posts):
        post = posts[post_id]
        due = referrer_due(post.published_on, base_date)
        if not due or (not full and post_id in referrer_computed):
            continue
        if post.published_on < measurement_start:
            # 30 日の窓が計測開始より前にかかる。問い合わせずに「計算済み、行なし」にする（03 §3）
            result.article_referrers[post_id] = Counter()
            continue
        result.article_referrers[post_id] = _fetch_article_referrers(client, post)
    log_count("ga4_period", "ga4_unknown_device_rows", client.usage.unknown_device_rows)
    return result


def _fetch_article_referrers(client: Ga4Client, post: PostRow) -> Counter[str]:
    window = NamedRange(
        "article",
        post.published_on,
        post.published_on + timedelta(days=_REFERRER_WINDOW_LAST_OFFSET),
    )
    # /4812 と /4812/ の両方を同じ記事として数える
    paths = [f"/{post.post_id}/", f"/{post.post_id}"]
    referrers: Counter[str] = Counter()
    for row in client.report("G17", [window], landing_paths=paths):
        source = normalize_referrer(row.dimensions["sessionSource"])
        if source is not None:
            referrers[source] += row.metric_int("sessions")
    return referrers
