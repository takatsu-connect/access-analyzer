"""U-13（時刻の変換の部分）: 基準日の既定値と WP REST API の時刻（02 §2.1、03 §3、NFR-82）。

暦日は Asia/Tokyo、実行時刻と WordPress の *_gmt は UTC。入力はすべて aware な時刻で、
ランナーのタイムゾーンを参照しない。
"""

from datetime import UTC, date, datetime, timedelta, timezone

import pytest

from takatsu_batch.tz import JST, format_utc, jst_date, now_utc, parse_wp_gmt, yesterday_jst

# UTC より遅れているタイムゾーンの例（固定の −8 時間）
MINUS_8 = timezone(timedelta(hours=-8))


@pytest.mark.parametrize(
    ("moment", "expected"),
    [
        # UTC 14:59:59 は JST 23:59:59 で、まだ同じ暦日
        (datetime(2026, 11, 4, 14, 59, 59, tzinfo=UTC), date(2026, 11, 4)),
        # UTC 15:00:00 は JST の翌日 0:00:00
        (datetime(2026, 11, 4, 15, 0, 0, tzinfo=UTC), date(2026, 11, 5)),
        (datetime(2026, 11, 4, 0, 0, 0, tzinfo=UTC), date(2026, 11, 4)),
        # 月末、年末、うるう日をまたぐ
        (datetime(2026, 10, 31, 14, 59, 59, tzinfo=UTC), date(2026, 10, 31)),
        (datetime(2026, 10, 31, 15, 0, 0, tzinfo=UTC), date(2026, 11, 1)),
        (datetime(2026, 12, 31, 14, 59, 59, tzinfo=UTC), date(2026, 12, 31)),
        (datetime(2026, 12, 31, 15, 0, 0, tzinfo=UTC), date(2027, 1, 1)),
        (datetime(2028, 2, 28, 15, 0, 0, tzinfo=UTC), date(2028, 2, 29)),
        (datetime(2028, 2, 29, 15, 0, 0, tzinfo=UTC), date(2028, 3, 1)),
        # 入力が UTC でなくても同じ瞬間なら同じ暦日
        (datetime(2026, 11, 5, 0, 0, 0, tzinfo=JST), date(2026, 11, 5)),
        (datetime(2026, 11, 4, 23, 59, 59, tzinfo=JST), date(2026, 11, 4)),
        (datetime(2026, 11, 4, 6, 59, 59, tzinfo=MINUS_8), date(2026, 11, 4)),
        (datetime(2026, 11, 4, 7, 0, 0, tzinfo=MINUS_8), date(2026, 11, 5)),
    ],
)
def test_jst_date(moment: datetime, expected: date) -> None:
    assert jst_date(moment) == expected


@pytest.mark.parametrize(
    ("moment", "expected"),
    [
        # 基準日は Asia/Tokyo の暦日の前日。UTC 15:00 を境に 1 日進む
        (datetime(2026, 11, 4, 14, 59, 59, tzinfo=UTC), date(2026, 11, 3)),
        (datetime(2026, 11, 4, 15, 0, 0, tzinfo=UTC), date(2026, 11, 4)),
        # UTC の日付が変わっても JST の暦日は変わらない
        (datetime(2026, 11, 4, 23, 59, 59, tzinfo=UTC), date(2026, 11, 4)),
        (datetime(2026, 11, 5, 0, 0, 0, tzinfo=UTC), date(2026, 11, 4)),
        # 月初、年初、うるう年の 3 月 1 日の前日
        (datetime(2026, 10, 31, 15, 0, 0, tzinfo=UTC), date(2026, 10, 31)),
        (datetime(2026, 12, 31, 14, 59, 59, tzinfo=UTC), date(2026, 12, 30)),
        (datetime(2026, 12, 31, 15, 0, 0, tzinfo=UTC), date(2026, 12, 31)),
        (datetime(2027, 2, 28, 15, 0, 0, tzinfo=UTC), date(2027, 2, 28)),
        (datetime(2028, 2, 29, 15, 0, 0, tzinfo=UTC), date(2028, 2, 29)),
        # 入力が JST や他のタイムゾーンでも同じ
        (datetime(2026, 11, 5, 0, 0, 0, tzinfo=JST), date(2026, 11, 4)),
        (datetime(2026, 11, 4, 23, 59, 59, tzinfo=JST), date(2026, 11, 3)),
        (datetime(2026, 11, 4, 7, 0, 0, tzinfo=MINUS_8), date(2026, 11, 4)),
    ],
)
def test_yesterday_jst(moment: datetime, expected: date) -> None:
    assert yesterday_jst(moment) == expected


def test_now_utc_is_aware_utc() -> None:
    assert now_utc().utcoffset() == timedelta(0)


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("2026-11-04T03:04:05", datetime(2026, 11, 4, 3, 4, 5, tzinfo=UTC)),
        ("2026-12-31T23:59:59", datetime(2026, 12, 31, 23, 59, 59, tzinfo=UTC)),
        ("2028-02-29T00:00:00", datetime(2028, 2, 29, 0, 0, 0, tzinfo=UTC)),
    ],
)
def test_parse_wp_gmt_returns_aware_utc(value: str, expected: datetime) -> None:
    parsed = parse_wp_gmt(value)
    assert parsed == expected
    assert parsed.tzinfo is UTC
    assert parsed.utcoffset() == timedelta(0)


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        # date_gmt が 14:59:59 なら公開日（JST）は同じ日、15:00:00 なら翌日
        ("2026-11-04T14:59:59", date(2026, 11, 4)),
        ("2026-11-04T15:00:00", date(2026, 11, 5)),
        ("2026-12-31T15:00:00", date(2027, 1, 1)),
    ],
)
def test_parse_wp_gmt_then_jst_date(value: str, expected: date) -> None:
    assert jst_date(parse_wp_gmt(value)) == expected


@pytest.mark.parametrize(
    ("moment", "expected"),
    [
        (datetime(2026, 11, 4, 3, 4, 5, tzinfo=UTC), "2026-11-04T03:04:05Z"),
        # 1 桁の月日と時刻はゼロ埋め
        (datetime(2026, 1, 2, 0, 0, 0, tzinfo=UTC), "2026-01-02T00:00:00Z"),
        # JST の入力は UTC に直す（日付、年をまたぐ）
        (datetime(2026, 11, 5, 0, 0, 0, tzinfo=JST), "2026-11-04T15:00:00Z"),
        (datetime(2027, 1, 1, 8, 59, 59, tzinfo=JST), "2026-12-31T23:59:59Z"),
        (datetime(2026, 11, 4, 7, 0, 0, tzinfo=MINUS_8), "2026-11-04T15:00:00Z"),
        # 秒未満は出さない
        (datetime(2026, 11, 4, 3, 4, 5, 999999, tzinfo=UTC), "2026-11-04T03:04:05Z"),
    ],
)
def test_format_utc(moment: datetime, expected: str) -> None:
    assert format_utc(moment) == expected


def test_format_utc_round_trips_through_parse_wp_gmt() -> None:
    moment = datetime(2026, 11, 4, 15, 0, 0, tzinfo=UTC)
    assert parse_wp_gmt(format_utc(moment).removesuffix("Z")) == moment


def test_ga4_ready_at_is_1530_jst_on_the_day_after_base_date() -> None:
    """基準日の GA4 の日次データが揃う時刻（03 §2）。

    二重実行の防止は、これ以降に始まった成功だけを数える。
    """
    from takatsu_batch.tz import ga4_ready_at

    ready = ga4_ready_at(date(2026, 11, 3))
    assert ready == datetime(2026, 11, 4, 6, 30, tzinfo=UTC)
    assert ready.utcoffset() == timedelta(hours=9)
    # 月末と年末をまたぐ
    assert ga4_ready_at(date(2026, 12, 31)) == datetime(2027, 1, 1, 6, 30, tzinfo=UTC)
