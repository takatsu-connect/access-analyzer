"""日別の取得（03 §1 工程 3、§5.4 G1〜G4、§9、§10）。生値をメモリに持つ。"""

from collections import Counter, defaultdict
from collections.abc import Collection, Iterable
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Final

from takatsu_batch.channel import map_channel
from takatsu_batch.config import (
    DEVICE_BUCKETS,
    GA4_BACKFILL_CHUNK_DAYS,
    REFETCH_DAYS,
    ChannelBucket,
    DeviceBucket,
)
from takatsu_batch.ga4_client import CHANNEL_DIMENSION, Ga4Client, NamedRange
from takatsu_batch.log import log_count
from takatsu_batch.page_path import extract_post_id

_RANGE_NAME: Final = "daily"
_DEVICES: Final[frozenset[str]] = frozenset(DEVICE_BUCKETS)


@dataclass(slots=True)
class DailyRaw:
    start: date
    end: date
    # 全体の日別（伏せ値なし）。キーは日付
    site: dict[date, tuple[int, int]] = field(default_factory=dict)
    channel: defaultdict[date, Counter[ChannelBucket]] = field(
        default_factory=lambda: defaultdict(Counter)
    )
    device_pv: defaultdict[date, Counter[DeviceBucket]] = field(
        default_factory=lambda: defaultdict(Counter)
    )
    device_sessions: defaultdict[date, Counter[DeviceBucket]] = field(
        default_factory=lambda: defaultdict(Counter)
    )
    # 記事 × 日。/4812 と /4812/ を合算した後の値
    article: Counter[tuple[int, date]] = field(default_factory=Counter)


def to_device_bucket(value: str) -> DeviceBucket | None:
    """3 区分に入らない値（smart tv など）は内訳に数えない。件数だけログに出す。"""
    normalized = value.strip().lower()
    return normalized if normalized in _DEVICES else None  # type: ignore[return-value]


def parse_ga4_date(value: str) -> date:
    """GA4 の date 次元（YYYYMMDD）はプロパティの TZ（Asia/Tokyo）の暦日のまま（02 §2.1）。"""
    return datetime.strptime(value, "%Y%m%d").date()  # noqa: DTZ007  # 暦日だけを使う


def fetch_ranges(base_date: date, backfill_from: date | None) -> list[NamedRange]:
    """通常は直近 7 日。バックフィルは 90 日ずつに分ける（03 §10）。"""
    if backfill_from is None:
        return [NamedRange(_RANGE_NAME, base_date - timedelta(days=REFETCH_DAYS - 1), base_date)]
    ranges: list[NamedRange] = []
    start = backfill_from
    while start <= base_date:
        end = min(start + timedelta(days=GA4_BACKFILL_CHUNK_DAYS - 1), base_date)
        ranges.append(NamedRange(_RANGE_NAME, start, end))
        start = end + timedelta(days=1)
    return ranges


def missing_days(raw: DailyRaw) -> int:
    """日別の値が返らなかった日の数。欠損として数えてログに残す。"""
    expected = (raw.end - raw.start).days + 1
    return expected - sum(raw.start <= day <= raw.end for day in raw.site)


def fetch(
    client: Ga4Client, ranges: Iterable[NamedRange], known_post_ids: Collection[int]
) -> DailyRaw:
    range_list = list(ranges)
    raw = DailyRaw(start=range_list[0].start, end=range_list[-1].end)
    for chunk in range_list:
        _fetch_chunk(client, chunk, known_post_ids, raw)
    log_count("ga4_daily", "ga4_missing_days", missing_days(raw))
    return raw


def _fetch_chunk(
    client: Ga4Client, chunk: NamedRange, known_post_ids: Collection[int], raw: DailyRaw
) -> None:
    single = [chunk]
    for row in client.report("G1", single):
        raw.site[parse_ga4_date(row.dimensions["date"])] = (
            row.metric_int("screenPageViews"),
            row.metric_int("sessions"),
        )
    for row in client.report("G2", single):
        day = parse_ga4_date(row.dimensions["date"])
        raw.channel[day][map_channel(row.dimensions[CHANNEL_DIMENSION])] += row.metric_int(
            "sessions"
        )
    for row in client.report("G3", single):
        device = to_device_bucket(row.dimensions["deviceCategory"])
        if device is None:
            client.usage.unknown_device_rows += 1
            continue
        day = parse_ga4_date(row.dimensions["date"])
        raw.device_pv[day][device] += row.metric_int("screenPageViews")
        raw.device_sessions[day][device] += row.metric_int("sessions")
    for row in client.report("G4", single):
        post_id = extract_post_id(row.dimensions["pagePath"])
        if post_id is not None and post_id in known_post_ids:
            raw.article[(post_id, parse_ga4_date(row.dimensions["date"]))] += row.metric_int(
                "screenPageViews"
            )
