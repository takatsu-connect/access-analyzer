"""日別の取得（03 §1 工程 3、§5.4 の G1〜G4、§9、§10）。I-B-08 の分割の単体版を含む。

期間の端（年末、月末）、バックフィルの 90 日分割、欠損日、ゼロ件、重複のない合算、再実行を確かめる。
"""

from collections import Counter
from collections.abc import Mapping
from datetime import date, timedelta

import pytest
from pydantic import SecretStr

from support.fake_ga4 import FakeGa4, FakeResponses
from takatsu_batch import ga4_daily
from takatsu_batch.ga4_client import Ga4Client, NamedRange
from takatsu_batch.ga4_daily import (
    DailyRaw,
    fetch_ranges,
    missing_days,
    parse_ga4_date,
    to_device_bucket,
)

CHANNEL = "sessionDefaultChannelGroup"
KNOWN_POST_IDS = frozenset({101, 102})
# 年末をまたぐ 7 日: 2025-12-28 〜 2026-01-03
BASE_DATE = date(2026, 1, 3)
D1231 = date(2025, 12, 31)
D0101 = date(2026, 1, 1)


def _client(fake: FakeGa4) -> Ga4Client:
    return Ga4Client(fake, SecretStr("123456789"), lambda _seconds: None, stop_low_quota=False)


def _plain[K, B](values: Mapping[K, Counter[B]]) -> dict[K, dict[B, int]]:
    return {key: dict(counter) for key, counter in values.items()}


# --- fetch_ranges ---


@pytest.mark.parametrize(
    ("base_date", "expected_start"),
    [
        (date(2026, 11, 4), date(2026, 10, 29)),
        # 年末と月末をまたぐ
        (date(2026, 1, 3), date(2025, 12, 28)),
        (date(2026, 3, 2), date(2026, 2, 24)),
        # うるう年ではない 2 月末
        (date(2026, 2, 28), date(2026, 2, 22)),
    ],
)
def test_fetch_ranges_daily_is_the_last_7_days_including_base_date(
    base_date: date, expected_start: date
) -> None:
    assert fetch_ranges(base_date, None) == [NamedRange("daily", expected_start, base_date)]


def test_fetch_ranges_backfill_from_measurement_start() -> None:
    ranges = fetch_ranges(date(2026, 11, 4), date(2025, 10, 8))
    # 393 日 → 90 日 × 4 + 33 日（03 §10 の「5 回ずつ」）
    assert ranges == [
        NamedRange("daily", date(2025, 10, 8), date(2026, 1, 5)),
        NamedRange("daily", date(2026, 1, 6), date(2026, 4, 5)),
        NamedRange("daily", date(2026, 4, 6), date(2026, 7, 4)),
        NamedRange("daily", date(2026, 7, 5), date(2026, 10, 2)),
        NamedRange("daily", date(2026, 10, 3), date(2026, 11, 4)),
    ]
    assert [(item.end - item.start).days + 1 for item in ranges] == [90, 90, 90, 90, 33]


@pytest.mark.parametrize(
    ("days", "expected_lengths"),
    [
        (1, [1]),
        (89, [89]),
        (90, [90]),
        (91, [90, 1]),
        (180, [90, 90]),
        (181, [90, 90, 1]),
    ],
)
def test_fetch_ranges_backfill_chunks_are_contiguous(
    days: int, expected_lengths: list[int]
) -> None:
    base_date = date(2026, 3, 1)
    start = base_date - timedelta(days=days - 1)
    ranges = fetch_ranges(base_date, start)
    assert [(item.end - item.start).days + 1 for item in ranges] == expected_lengths
    # 抜けも重なりもなく、最初が from、最後が基準日
    assert ranges[0].start == start
    assert ranges[-1].end == base_date
    for previous, current in zip(ranges, ranges[1:], strict=False):
        assert current.start == previous.end + timedelta(days=1)


# --- 区分と日付 ---


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("mobile", "mobile"),
        ("Desktop", "desktop"),
        ("tablet", "tablet"),
        (" Tablet ", "tablet"),
        ("smart tv", None),
        ("(not set)", None),
        ("", None),
    ],
)
def test_to_device_bucket(value: str, expected: str | None) -> None:
    assert to_device_bucket(value) == expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("20251008", date(2025, 10, 8)),
        ("20251231", date(2025, 12, 31)),
        ("20260101", date(2026, 1, 1)),
        ("20280229", date(2028, 2, 29)),
    ],
)
def test_parse_ga4_date(value: str, expected: date) -> None:
    assert parse_ga4_date(value) == expected


@pytest.mark.parametrize("value", ["", "2025-10-08", "20260229", "20251301", "(other)"])
def test_parse_ga4_date_rejects_other_formats(value: str) -> None:
    with pytest.raises(ValueError):  # noqa: PT011  # メッセージは strptime のもので固定しない
        parse_ga4_date(value)


@pytest.mark.parametrize(
    ("site_days", "expected"),
    [
        # 7 日すべてある
        ([date(2025, 12, 28) + timedelta(days=offset) for offset in range(7)], 0),
        # 1 日欠けている
        ([date(2025, 12, 28) + timedelta(days=offset) for offset in range(7) if offset != 2], 1),
        # 端の日だけある
        ([date(2025, 12, 28), date(2026, 1, 3)], 5),
        # 1 件もない
        ([], 7),
        # 期間の外の日は数えない
        ([date(2025, 12, 27), date(2026, 1, 4)], 7),
    ],
)
def test_missing_days(site_days: list[date], expected: int) -> None:
    raw = DailyRaw(
        start=date(2025, 12, 28), end=date(2026, 1, 3), site=dict.fromkeys(site_days, (1, 1))
    )
    assert missing_days(raw) == expected


# --- fetch ---

DAILY_RESPONSES: FakeResponses = {
    # 2025-12-30 の行がない（欠損日）。2026-01-01 は 0 件の行
    "G1": {
        "daily": [
            ({"date": "20251228"}, {"screenPageViews": "100", "sessions": "40"}),
            ({"date": "20251229"}, {"screenPageViews": "110", "sessions": "45"}),
            ({"date": "20251231"}, {"screenPageViews": "90", "sessions": "30"}),
            ({"date": "20260101"}, {"screenPageViews": "0", "sessions": "0"}),
            ({"date": "20260102"}, {"screenPageViews": "120", "sessions": "50"}),
            ({"date": "20260103"}, {"screenPageViews": "130", "sessions": "55"}),
        ]
    },
    "G2": {
        "daily": [
            ({"date": "20251231", CHANNEL: "Organic Search"}, {"sessions": "10"}),
            ({"date": "20251231", CHANNEL: "Organic Social"}, {"sessions": "5"}),
            ({"date": "20251231", CHANNEL: "Direct"}, {"sessions": "3"}),
            ({"date": "20251231", CHANNEL: "Referral"}, {"sessions": "2"}),
            ({"date": "20251231", CHANNEL: "Email"}, {"sessions": "1"}),
            ({"date": "20251231", CHANNEL: "Unassigned"}, {"sessions": "4"}),
            ({"date": "20251231", CHANNEL: "Paid Search"}, {"sessions": "2"}),
            ({"date": "20260101", CHANNEL: "Organic Search"}, {"sessions": "1"}),
        ]
    },
    # smart tv と (not set) は 3 区分に入らない
    "G3": {
        "daily": [
            (
                {"date": "20251231", "deviceCategory": "mobile"},
                {"screenPageViews": "60", "sessions": "20"},
            ),
            (
                {"date": "20251231", "deviceCategory": "desktop"},
                {"screenPageViews": "25", "sessions": "8"},
            ),
            (
                {"date": "20251231", "deviceCategory": "tablet"},
                {"screenPageViews": "5", "sessions": "2"},
            ),
            (
                {"date": "20251231", "deviceCategory": "smart tv"},
                {"screenPageViews": "3", "sessions": "1"},
            ),
            (
                {"date": "20251231", "deviceCategory": "(not set)"},
                {"screenPageViews": "2", "sessions": "2"},
            ),
            (
                {"date": "20260101", "deviceCategory": "Mobile"},
                {"screenPageViews": "4", "sessions": "2"},
            ),
        ]
    },
    "G4": {
        "daily": [
            # /101/ と /101 は同じ記事
            ({"date": "20251231", "pagePath": "/101/"}, {"screenPageViews": "5"}),
            ({"date": "20251231", "pagePath": "/101"}, {"screenPageViews": "3"}),
            ({"date": "20260101", "pagePath": "/101/"}, {"screenPageViews": "2"}),
            ({"date": "20251231", "pagePath": "/102/"}, {"screenPageViews": "4"}),
            # wp_post にない ID
            ({"date": "20251231", "pagePath": "/999/"}, {"screenPageViews": "9"}),
            # 記事以外
            ({"date": "20251231", "pagePath": "/"}, {"screenPageViews": "50"}),
            ({"date": "20251231", "pagePath": "/category/news/"}, {"screenPageViews": "7"}),
            ({"date": "20251231", "pagePath": "/101/2/"}, {"screenPageViews": "1"}),
            ({"date": "20251231", "pagePath": "/0101/"}, {"screenPageViews": "1"}),
        ]
    },
}


def test_fetch_aggregates_g1_to_g4(capsys: pytest.CaptureFixture[str]) -> None:
    fake = FakeGa4(DAILY_RESPONSES)
    client = _client(fake)
    raw = ga4_daily.fetch(client, fetch_ranges(BASE_DATE, None), KNOWN_POST_IDS)

    assert (raw.start, raw.end) == (date(2025, 12, 28), BASE_DATE)
    assert raw.site == {
        date(2025, 12, 28): (100, 40),
        date(2025, 12, 29): (110, 45),
        D1231: (90, 30),
        D0101: (0, 0),
        date(2026, 1, 2): (120, 50),
        BASE_DATE: (130, 55),
    }
    # チャネルは 5 区分に正規化する。Email、Unassigned、Paid Search は other
    assert _plain(raw.channel) == {
        D1231: {"search": 10, "social": 5, "direct": 3, "referral": 2, "other": 7},
        D0101: {"search": 1},
    }
    assert _plain(raw.device_pv) == {
        D1231: {"mobile": 60, "desktop": 25, "tablet": 5},
        D0101: {"mobile": 4},
    }
    assert _plain(raw.device_sessions) == {
        D1231: {"mobile": 20, "desktop": 8, "tablet": 2},
        D0101: {"mobile": 2},
    }
    # 未知の device は件数だけ数え、値には入れない
    assert client.usage.unknown_device_rows == 2
    # /101/ と /101 を合算し、未知の ID と記事以外は捨てる
    assert dict(raw.article) == {(101, D1231): 8, (101, D0101): 2, (102, D1231): 4}

    # G1〜G4 を 1 回ずつ、直近 7 日の 1 つの期間で送る
    assert fake.query_ids == ["G1", "G2", "G3", "G4"]
    for request in fake.requests:
        assert [(item.name, item.start_date, item.end_date) for item in request.date_ranges] == [
            ("daily", "2025-12-28", "2026-01-03")
        ]
    # 欠損日（2025-12-30）は件数としてログに出る
    assert missing_days(raw) == 1
    assert '{"step":"ga4_daily","count":"ga4_missing_days","n":1}' in capsys.readouterr().out


def test_fetch_with_no_rows_counts_every_day_as_missing(capsys: pytest.CaptureFixture[str]) -> None:
    fake = FakeGa4({})
    raw = ga4_daily.fetch(_client(fake), fetch_ranges(BASE_DATE, None), KNOWN_POST_IDS)
    assert raw.site == {}
    assert not raw.channel
    assert not raw.device_pv
    assert not raw.device_sessions
    assert not raw.article
    assert fake.query_ids == ["G1", "G2", "G3", "G4"]
    assert '{"step":"ga4_daily","count":"ga4_missing_days","n":7}' in capsys.readouterr().out


def test_fetch_twice_gives_the_same_result() -> None:
    # 再実行しても同じ（§9）。取得のたびに新しい DailyRaw を作るので、値が足し込まれない
    first = ga4_daily.fetch(
        _client(FakeGa4(DAILY_RESPONSES)), fetch_ranges(BASE_DATE, None), KNOWN_POST_IDS
    )
    second = ga4_daily.fetch(
        _client(FakeGa4(DAILY_RESPONSES)), fetch_ranges(BASE_DATE, None), KNOWN_POST_IDS
    )
    assert first == second


def test_fetch_backfill_sends_each_chunk_and_does_not_double_count() -> None:
    # 100 日 → 90 日 + 10 日。分割の境界（2026-01-05 と 01-06）の両側に行を置く
    start = date(2025, 10, 8)
    base_date = date(2026, 1, 15)
    responses: FakeResponses = {
        "G1": {
            "daily": [
                ({"date": "20251008"}, {"screenPageViews": "11", "sessions": "5"}),
                ({"date": "20251231"}, {"screenPageViews": "12", "sessions": "6"}),
                ({"date": "20260105"}, {"screenPageViews": "13", "sessions": "7"}),
                ({"date": "20260106"}, {"screenPageViews": "14", "sessions": "8"}),
                ({"date": "20260115"}, {"screenPageViews": "15", "sessions": "9"}),
            ]
        },
        "G2": {
            "daily": [
                ({"date": "20260105", CHANNEL: "Direct"}, {"sessions": "7"}),
                ({"date": "20260106", CHANNEL: "Direct"}, {"sessions": "8"}),
            ]
        },
        "G3": {
            "daily": [
                (
                    {"date": "20260105", "deviceCategory": "mobile"},
                    {"screenPageViews": "13", "sessions": "7"},
                ),
                (
                    {"date": "20260106", "deviceCategory": "mobile"},
                    {"screenPageViews": "14", "sessions": "8"},
                ),
            ]
        },
        "G4": {
            "daily": [
                ({"date": "20260105", "pagePath": "/101/"}, {"screenPageViews": "5"}),
                ({"date": "20260106", "pagePath": "/101/"}, {"screenPageViews": "7"}),
            ]
        },
    }
    fake = FakeGa4(responses)
    raw = ga4_daily.fetch(_client(fake), fetch_ranges(base_date, start), KNOWN_POST_IDS)

    assert fake.query_ids == ["G1", "G2", "G3", "G4"] * 2
    assert [
        (request.date_ranges[0].start_date, request.date_ranges[0].end_date)
        for request in fake.requests
    ] == [("2025-10-08", "2026-01-05")] * 4 + [("2026-01-06", "2026-01-15")] * 4
    assert (raw.start, raw.end) == (start, base_date)
    assert raw.site == {
        date(2025, 10, 8): (11, 5),
        D1231: (12, 6),
        date(2026, 1, 5): (13, 7),
        date(2026, 1, 6): (14, 8),
        date(2026, 1, 15): (15, 9),
    }
    assert _plain(raw.channel) == {date(2026, 1, 5): {"direct": 7}, date(2026, 1, 6): {"direct": 8}}
    assert _plain(raw.device_pv) == {
        date(2026, 1, 5): {"mobile": 13},
        date(2026, 1, 6): {"mobile": 14},
    }
    assert dict(raw.article) == {(101, date(2026, 1, 5)): 5, (101, date(2026, 1, 6)): 7}
    assert missing_days(raw) == 100 - 5
