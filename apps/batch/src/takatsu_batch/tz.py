"""時刻の変換を 1 か所に集める（02 §2.1、NFR-82）。

暦日は Asia/Tokyo、実行時刻と WordPress の *_gmt は UTC。ランナーのタイムゾーンに依存しない。
"""

from datetime import UTC, date, datetime, time, timedelta
from typing import Final
from zoneinfo import ZoneInfo

from takatsu_batch.config import GA4_DATA_READY_JST

JST: Final = ZoneInfo("Asia/Tokyo")


def now_utc() -> datetime:
    return datetime.now(UTC)


def jst_date(moment: datetime) -> date:
    """aware な時刻の Asia/Tokyo の暦日。"""
    return moment.astimezone(JST).date()


def yesterday_jst(moment: datetime) -> date:
    """基準日の既定値: 実行時刻を Asia/Tokyo にした日付の前日（03 §3）。"""
    return jst_date(moment) - timedelta(days=1)


def ga4_ready_at(base_date: date) -> datetime:
    """基準日の GA4 の日次データが揃う時刻。基準日の翌日の JST 15:30（03 §2）。"""
    hour, minute = GA4_DATA_READY_JST
    return datetime.combine(base_date + timedelta(days=1), time(hour, minute), tzinfo=JST)


def parse_wp_gmt(value: str) -> datetime:
    """WP REST API の date_gmt / modified_gmt（タイムゾーンなしの UTC）を aware にする。"""
    return datetime.fromisoformat(value).replace(tzinfo=UTC)


def format_utc(moment: datetime) -> str:
    """WP REST API の modified_after に渡す形（ISO 8601、UTC）。"""
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
