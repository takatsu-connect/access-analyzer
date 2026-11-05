"""期間別の取得（03 §1 工程 4、§3、§5.3、§5.4 の G5〜G17・G19・G20）。

区分の正規化、参照元の計算の時期の境界、期間集合の 4 つずつの分割、確定月の補い、
記事の参照元（G17）の対象の選び方を確かめる。
"""

from collections import Counter
from collections.abc import Mapping
from datetime import UTC, date, datetime

import pytest
from pydantic import SecretStr

from support.fake_ga4 import FakeGa4, FakeResponses, identify_query, landing_paths_of
from takatsu_batch import ga4_period
from takatsu_batch.db import PostRow
from takatsu_batch.ga4_client import Ga4Client
from takatsu_batch.ga4_period import (
    PeriodRaw,
    classify_local,
    normalize_referrer,
    referrer_due,
    to_new_returning,
)
from takatsu_batch.period import Period, PeriodPlan, plan_periods

CHANNEL = "sessionDefaultChannelGroup"
BASE_DATE = date(2025, 12, 20)
# 期間集合で送る問い合わせ（G9 は確定月の補いでも使うので別に確かめる）
PERIOD_SET_QUERIES = (
    "G5",
    "G6",
    "G7",
    "G8",
    "G10",
    "G11",
    "G12",
    "G13",
    "G14",
    "G15",
    "G19",
    "G20",
)
CHUNK_1 = ("last7", "prev7", "last28", "prev28")
CHUNK_2 = ("last90", "prev90", "m2025-11", "m2025-12")


def _client(fake: FakeGa4) -> Ga4Client:
    return Ga4Client(fake, SecretStr("123456789"), lambda _seconds: None, stop_low_quota=False)


def _plain[K, B](values: Mapping[K, Counter[B]]) -> dict[K, dict[B, int]]:
    return {key: dict(counter) for key, counter in values.items()}


def _post(post_id: int, published_on: date) -> PostRow:
    published_at = datetime(
        published_on.year, published_on.month, published_on.day, 3, 0, tzinfo=UTC
    )
    return PostRow(
        post_id=post_id,
        title=f"架空の記事 {post_id}",
        post_url=f"https://takatsu-connect.com/{post_id}/",
        author_slug="writer-a",
        published_at=published_at,
        published_on=published_on,
        modified_at=published_at,
        is_ad=False,
        first_seen_on=published_on,
    )


def _ranges_by_query(fake: FakeGa4) -> dict[str, list[tuple[str, ...]]]:
    """問い合わせごとに、送った date_ranges の名前を送った順に並べる。"""
    result: dict[str, list[tuple[str, ...]]] = {}
    for request in fake.requests:
        names = tuple(item.name for item in request.date_ranges)
        result.setdefault(identify_query(request), []).append(names)
    return result


# --- 区分の正規化 ---


@pytest.mark.parametrize(
    ("value", "expected"),
    [("new", "new"), ("returning", "returning"), ("", "unknown"), ("(not set)", "unknown")],
)
def test_to_new_returning(value: str, expected: str) -> None:
    assert to_new_returning(value) == expected


@pytest.mark.parametrize(
    ("country", "city", "expected"),
    [
        ("Japan", "Kawasaki", "kawasaki"),
        ("Japan", "Yokohama", "japan_other"),
        ("Japan", "(not set)", "unknown"),
        ("Japan", "", "unknown"),
        # 国外は市の名前が同じでも unknown
        ("United States", "Kawasaki", "unknown"),
        ("(not set)", "(not set)", "unknown"),
        ("", "Kawasaki", "unknown"),
    ],
)
def test_classify_local(country: str, city: str, expected: str) -> None:
    assert classify_local(country, city) == expected


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        ("example.com", "example.com"),
        ("Example.COM", "example.com"),
        (" example.com ", "example.com"),
        ("(direct)", None),
        ("(Direct)", None),
        ("(not set)", None),
        ("", None),
        ("  ", None),
    ],
)
def test_normalize_referrer(source: str, expected: str | None) -> None:
    assert normalize_referrer(source) == expected


@pytest.mark.parametrize(
    ("published_on", "base_date", "expected"),
    [
        # 公開日 + 36 日 = 基準日 で初めて計算する（30 日目 = 公開日 + 29、遅延 7 日）
        (date(2025, 11, 14), date(2025, 12, 20), True),
        (date(2025, 11, 14), date(2025, 12, 19), False),
        (date(2025, 11, 15), date(2025, 12, 20), False),
        (date(2025, 11, 14), date(2026, 6, 1), True),
        # 年をまたぐ
        (date(2025, 12, 1), date(2026, 1, 6), True),
        (date(2025, 12, 1), date(2026, 1, 5), False),
        # うるう年の 2 月をまたぐ
        (date(2028, 1, 25), date(2028, 3, 1), True),
        (date(2028, 1, 25), date(2028, 2, 29), False),
        # 公開した当日
        (date(2025, 12, 20), date(2025, 12, 20), False),
    ],
)
def test_referrer_due(published_on: date, base_date: date, expected: bool) -> None:
    assert referrer_due(published_on, base_date) is expected


# --- fetch ---

POSTS = {
    # 30 日が経過し、まだ計算していない
    101: _post(101, date(2025, 10, 10)),
    # 30 日が経過し、計算済み
    102: _post(102, date(2025, 10, 20)),
    # 公開日 + 36 日 = 基準日（境界）
    103: _post(103, date(2025, 11, 14)),
    # 公開日 + 36 日 = 基準日の翌日（まだ）
    104: _post(104, date(2025, 11, 15)),
}
REFERRER_COMPUTED = {102: date(2025, 11, 30)}

PERIOD_RESPONSES: FakeResponses = {
    "G5": {
        # 秒は小数で返ることがある。切り捨てる
        "last7": [({}, {"activeUsers": "120", "userEngagementDuration": "4567.8"})],
        "m2025-11": [({}, {"activeUsers": "900", "userEngagementDuration": "33000"})],
        "m2025-12": [({}, {"activeUsers": "300", "userEngagementDuration": "9000"})],
    },
    "G6": {
        "last7": [
            ({"newVsReturning": "new"}, {"activeUsers": "80"}),
            ({"newVsReturning": "returning"}, {"activeUsers": "35"}),
            ({"newVsReturning": "(not set)"}, {"activeUsers": "3"}),
            ({"newVsReturning": ""}, {"activeUsers": "2"}),
        ]
    },
    "G7": {
        "last7": [
            ({"sessionSource": "l.instagram.com"}, {"sessions": "12"}),
            ({"sessionSource": "Instagram"}, {"sessions": "3"}),
            ({"sessionSource": "t.co"}, {"sessions": "4"}),
            # 規則に other と明記された値。unmapped には残さない
            ({"sessionSource": "threads.net"}, {"sessions": "2"}),
            # どの規則にも当たらない値。大文字小文字をそろえて残す
            ({"sessionSource": "Mystery.Example"}, {"sessions": "6"}),
            ({"sessionSource": "mystery.example"}, {"sessions": "1"}),
        ]
    },
    "G8": {
        "last7": [
            ({"dayOfWeek": "0", "hour": "09"}, {"screenPageViews": "40"}),
            ({"dayOfWeek": "6", "hour": "23"}, {"screenPageViews": "5"}),
        ]
    },
    "G9": {
        "last7": [
            ({"country": "Japan", "region": "Kanagawa", "city": "Kawasaki"}, {"sessions": "50"}),
            ({"country": "Japan", "region": "Kanagawa", "city": "Yokohama"}, {"sessions": "20"}),
            ({"country": "Japan", "region": "Tokyo", "city": "Setagaya City"}, {"sessions": "10"}),
            ({"country": "Japan", "region": "(not set)", "city": "(not set)"}, {"sessions": "4"}),
            (
                {"country": "United States", "region": "California", "city": "Kawasaki"},
                {"sessions": "2"},
            ),
            ({"country": "Japan", "region": "Kanagawa", "city": ""}, {"sessions": "1"}),
            # 市は分かるが都道府県が不明。3 区分には数え、市別には入れない
            ({"country": "Japan", "region": "(not set)", "city": "Kawasaki"}, {"sessions": "3"}),
        ],
        "m2025-11": [
            ({"country": "Japan", "region": "Kanagawa", "city": "Kawasaki"}, {"sessions": "500"}),
            ({"country": "Japan", "region": "Kanagawa", "city": "Yokohama"}, {"sessions": "200"}),
        ],
        # 取り直さない確定月。市別の補いのときだけ問い合わせる
        "m2025-10": [
            ({"country": "Japan", "region": "Kanagawa", "city": "Kawasaki"}, {"sessions": "400"}),
            ({"country": "Japan", "region": "Osaka", "city": "Osaka"}, {"sessions": "30"}),
            (
                {"country": "United States", "region": "California", "city": "Los Angeles"},
                {"sessions": "5"},
            ),
            ({"country": "Japan", "region": "(not set)", "city": "(not set)"}, {"sessions": "9"}),
        ],
    },
    "G10": {
        "last7": [
            ({"landingPage": "/101/"}, {"sessions": "30"}),
            ({"landingPage": "/101"}, {"sessions": "5"}),
            ({"landingPage": "/102/"}, {"sessions": "8"}),
            ({"landingPage": "/"}, {"sessions": "100"}),
            ({"landingPage": "/999/"}, {"sessions": "7"}),
            ({"landingPage": "(not set)"}, {"sessions": "6"}),
        ]
    },
    "G11": {
        "last7": [
            ({"pagePath": "/101/"}, {"userEngagementDuration": "1234.5"}),
            ({"pagePath": "/category/news/"}, {"userEngagementDuration": "999"}),
        ]
    },
    "G12": {
        "last7": [
            ({"pagePath": "/101/"}, {"eventCount": "22"}),
            ({"pagePath": "/102/"}, {"eventCount": "4"}),
            ({"pagePath": "/"}, {"eventCount": "77"}),
        ]
    },
    "G13": {
        "last7": [
            ({"landingPage": "/101/", CHANNEL: "Organic Search"}, {"sessions": "20"}),
            ({"landingPage": "/101", CHANNEL: "Organic Search"}, {"sessions": "2"}),
            ({"landingPage": "/101/", CHANNEL: "Email"}, {"sessions": "1"}),
            ({"landingPage": "/", CHANNEL: "Direct"}, {"sessions": "50"}),
        ]
    },
    "G14": {
        "last7": [
            ({"landingPage": "/101/", "sessionSource": "l.instagram.com"}, {"sessions": "6"}),
            ({"landingPage": "/101/", "sessionSource": "mystery.example"}, {"sessions": "2"}),
            ({"landingPage": "/category/news/", "sessionSource": "t.co"}, {"sessions": "9"}),
        ]
    },
    "G15": {
        "last7": [
            ({"landingPage": "/101/", "deviceCategory": "mobile"}, {"sessions": "25"}),
            ({"landingPage": "/101/", "deviceCategory": "smart tv"}, {"sessions": "1"}),
            ({"landingPage": "/", "deviceCategory": "desktop"}, {"sessions": "40"}),
        ]
    },
    "G16": {
        "m2025-10": [({"sessionSource": "old.example"}, {"sessions": "70"})],
        "m2025-11": [
            ({"sessionSource": "News.Example"}, {"sessions": "40"}),
            ({"sessionSource": "news.example"}, {"sessions": "2"}),
            ({"sessionSource": "blog.example"}, {"sessions": "8"}),
            ({"sessionSource": "(direct)"}, {"sessions": "9"}),
            ({"sessionSource": "(not set)"}, {"sessions": "3"}),
        ],
    },
    "G17": {
        "article": [
            ({"landingPage": "/101/", "sessionSource": "Example.com"}, {"sessions": "7"}),
            ({"landingPage": "/101", "sessionSource": "example.com"}, {"sessions": "3"}),
            ({"landingPage": "/101/", "sessionSource": "(direct)"}, {"sessions": "9"}),
            ({"landingPage": "/102/", "sessionSource": "blog.example"}, {"sessions": "4"}),
            ({"landingPage": "/103/", "sessionSource": "news.example"}, {"sessions": "6"}),
            ({"landingPage": "/104/", "sessionSource": "early.example"}, {"sessions": "8"}),
        ]
    },
    "G19": {
        "last7": [
            ({CHANNEL: "Organic Search"}, {"sessions": "60"}),
            ({CHANNEL: "Organic Social"}, {"sessions": "20"}),
            ({CHANNEL: "Direct"}, {"sessions": "15"}),
            ({CHANNEL: "Referral"}, {"sessions": "5"}),
            ({CHANNEL: "Unassigned"}, {"sessions": "2"}),
            ({CHANNEL: "Email"}, {"sessions": "1"}),
        ]
    },
    "G20": {
        "last7": [
            ({"deviceCategory": "mobile"}, {"screenPageViews": "300", "sessions": "90"}),
            ({"deviceCategory": "desktop"}, {"screenPageViews": "100", "sessions": "30"}),
            ({"deviceCategory": "tablet"}, {"screenPageViews": "10", "sessions": "4"}),
            ({"deviceCategory": "smart tv"}, {"screenPageViews": "5", "sessions": "2"}),
        ]
    },
}


def _daily_plan() -> PeriodPlan:
    """2025-10 は確定済みで参照元もある。市別はまだない。"""
    return plan_periods(
        BASE_DATE,
        prior_confirmed={"m2025-10"},
        referrer_months={"m2025-10"},
        city_months=set(),
        full=False,
    )


def test_plan_of_the_daily_scenario() -> None:
    # 以下の fetch のテストの前提
    plan = _daily_plan()
    assert tuple(item.period_id for item in plan.refetch) == CHUNK_1 + CHUNK_2
    assert [item.period_id for item in plan.referrer_months] == ["m2025-11"]
    assert [item.period_id for item in plan.city_extra_months] == ["m2025-10"]


def test_fetch_sends_the_period_set_four_ranges_at_a_time() -> None:
    plan = _daily_plan()
    fake = FakeGa4(PERIOD_RESPONSES)
    ga4_period.fetch(_client(fake), plan, POSTS, REFERRER_COMPUTED, BASE_DATE, full=False)

    sent = _ranges_by_query(fake)
    for query_id in PERIOD_SET_QUERIES:
        assert sent[query_id] == [CHUNK_1, CHUNK_2], query_id
    # G9 は期間集合の 2 回に、市別だけを補う確定月の 1 回が加わる
    assert sent["G9"] == [CHUNK_1, CHUNK_2, ("m2025-10",)]
    assert sent["G16"] == [("m2025-11",)]
    assert sent["G17"] == [("article",), ("article",)]
    assert set(sent) == {*PERIOD_SET_QUERIES, "G9", "G16", "G17"}
    # 日付は period の行のとおり
    first_g5 = next(request for request in fake.requests if identify_query(request) == "G5")
    assert [(item.name, item.start_date, item.end_date) for item in first_g5.date_ranges] == [
        (item.period_id, item.start_date.isoformat(), item.end_date.isoformat())
        for item in plan.refetch[:4]
    ]


def test_fetch_fills_each_period(capsys: pytest.CaptureFixture[str]) -> None:
    fake = FakeGa4(PERIOD_RESPONSES)
    client = _client(fake)
    result = ga4_period.fetch(
        client, _daily_plan(), POSTS, REFERRER_COMPUTED, BASE_DATE, full=False
    )

    assert set(result.periods) == {*CHUNK_1, *CHUNK_2}
    last7 = result.periods["last7"]
    assert (last7.active_users, last7.engagement_seconds) == (120, 4567)
    assert dict(last7.new_returning) == {"new": 80, "returning": 35, "unknown": 5}
    # unmapped は other に数え、参照元の名前は別に残す
    assert dict(last7.sns) == {"instagram": 15, "x": 4, "other": 9}
    assert dict(last7.unmapped_sources) == {"mystery.example": 7}
    assert dict(last7.heatmap) == {(0, 9): 40, (6, 23): 5}
    assert dict(last7.local) == {"kawasaki": 53, "japan_other": 30, "unknown": 7}
    assert dict(last7.cities) == {
        ("Kanagawa", "Kawasaki"): 50,
        ("Kanagawa", "Yokohama"): 20,
        ("Tokyo", "Setagaya City"): 10,
    }
    assert dict(last7.channel) == {
        "search": 60,
        "social": 20,
        "direct": 15,
        "referral": 5,
        "other": 3,
    }
    assert dict(last7.device_pv) == {"mobile": 300, "desktop": 100, "tablet": 10}
    assert dict(last7.device_sessions) == {"mobile": 90, "desktop": 30, "tablet": 4}
    # 記事の軸: /101/ と /101 を合算し、記事以外と未知の ID の landingPage は捨てる
    assert dict(last7.landing_sessions) == {101: 35, 102: 8}
    assert dict(last7.engagement_by_post) == {101: 1234}
    assert dict(last7.scroll_by_post) == {101: 22, 102: 4}
    assert _plain(last7.article_channel) == {101: {"search": 22, "other": 1}}
    assert _plain(last7.article_sns) == {101: {"instagram": 6, "other": 2}}
    assert _plain(last7.article_device) == {101: {"mobile": 25}}

    # 2 つ目の集合の期間にも、その期間の行だけが入る
    november = result.periods["m2025-11"]
    assert (november.active_users, november.engagement_seconds) == (900, 33000)
    assert dict(november.local) == {"kawasaki": 500, "japan_other": 200}
    assert dict(november.cities) == {("Kanagawa", "Kawasaki"): 500, ("Kanagawa", "Yokohama"): 200}
    assert result.periods["m2025-12"].active_users == 300
    # 行のない期間は 0 のまま
    for period_id in ("prev7", "last28", "prev28", "last90", "prev90"):
        assert result.periods[period_id] == PeriodRaw(), period_id

    # G20 と G15 の smart tv
    assert client.usage.unknown_device_rows == 2
    assert (
        '{"step":"ga4_period","count":"ga4_unknown_device_rows","n":2}' in capsys.readouterr().out
    )


def test_fetch_fills_cities_and_referrers_only_for_the_planned_months() -> None:
    fake = FakeGa4(PERIOD_RESPONSES)
    result = ga4_period.fetch(
        _client(fake), _daily_plan(), POSTS, REFERRER_COMPUTED, BASE_DATE, full=False
    )
    # 市別の補いは city_extra_months だけ。国外と (not set) は入れない
    assert _plain(result.extra_cities) == {
        "m2025-10": {("Kanagawa", "Kawasaki"): 400, ("Osaka", "Osaka"): 30}
    }
    assert "m2025-10" not in result.periods
    # 参照元は referrer_months だけ。大文字小文字を合算し、(direct) と (not set) は除く
    assert _plain(result.month_referrers) == {"m2025-11": {"news.example": 42, "blog.example": 8}}


def test_fetch_article_referrers_only_for_due_and_not_yet_computed_posts() -> None:
    fake = FakeGa4(PERIOD_RESPONSES)
    result = ga4_period.fetch(
        _client(fake), _daily_plan(), POSTS, REFERRER_COMPUTED, BASE_DATE, full=False
    )
    # 102 は計算済み、104 は 30 日 + 遅延がまだ
    assert _plain(result.article_referrers) == {
        101: {"example.com": 10},
        103: {"news.example": 6},
    }
    g17 = [request for request in fake.requests if identify_query(request) == "G17"]
    # /<id>/ と /<id> の両方を同じ記事として数える
    assert [landing_paths_of(request) for request in g17] == [
        ("/101/", "/101"),
        ("/103/", "/103"),
    ]
    # 期間は公開日から 30 日目まで
    assert [
        (request.date_ranges[0].start_date, request.date_ranges[0].end_date) for request in g17
    ] == [("2025-10-10", "2025-11-08"), ("2025-11-14", "2025-12-13")]


@pytest.mark.parametrize("full", [False, True])
def test_fetch_does_not_query_referrers_of_posts_published_before_measurement(full: bool) -> None:
    """計測開始より前に公開した記事は 30 日の窓がそろわない。

    問い合わせず、計算済み・行なしにする。
    """
    posts = {
        # 計測開始（2025-10-08）の前日と当日
        201: _post(201, date(2025, 10, 7)),
        202: _post(202, date(2025, 10, 8)),
        203: _post(203, date(2024, 5, 1)),
    }
    fake = FakeGa4(PERIOD_RESPONSES)
    result = ga4_period.fetch(_client(fake), _daily_plan(), posts, {}, BASE_DATE, full=full)
    assert _plain(result.article_referrers) == {201: {}, 202: {}, 203: {}}
    g17 = [request for request in fake.requests if identify_query(request) == "G17"]
    assert [landing_paths_of(request) for request in g17] == [("/202/", "/202")]


def test_fetch_full_refetches_everything_that_is_due() -> None:
    plan = plan_periods(
        BASE_DATE,
        prior_confirmed={"m2025-10"},
        referrer_months={"m2025-10"},
        city_months={"m2025-10"},
        full=True,
    )
    fake = FakeGa4(PERIOD_RESPONSES)
    result = ga4_period.fetch(_client(fake), plan, POSTS, REFERRER_COMPUTED, BASE_DATE, full=True)

    sent = _ranges_by_query(fake)
    # 移動窓 6 + 月 3 = 9 期間 → 4、4、1
    last_chunk = ("m2025-12",)
    first_chunk = ("last7", "prev7", "last28", "prev28")
    second_chunk = ("last90", "prev90", "m2025-10", "m2025-11")
    for query_id in (*PERIOD_SET_QUERIES, "G9"):
        assert sent[query_id] == [first_chunk, second_chunk, last_chunk], query_id
    # 期間が 1 つだけの集合（dateRange の列がない応答）も、その期間に入る
    assert result.periods["m2025-12"].active_users == 300
    assert result.periods["m2025-11"].active_users == 900
    # すべての月を取り直すので、市別だけの補いはない
    assert result.extra_cities == {}
    assert dict(result.periods["m2025-10"].cities) == {
        ("Kanagawa", "Kawasaki"): 400,
        ("Osaka", "Osaka"): 30,
    }
    # 確定月の参照元はすべて取り直す
    assert sent["G16"] == [("m2025-10",), ("m2025-11",)]
    assert _plain(result.month_referrers) == {
        "m2025-10": {"old.example": 70},
        "m2025-11": {"news.example": 42, "blog.example": 8},
    }
    # 計算済みの 102 も取り直す。30 日 + 遅延がまだの 104 は full でも取らない
    assert _plain(result.article_referrers) == {
        101: {"example.com": 10},
        102: {"blog.example": 4},
        103: {"news.example": 6},
    }


def test_fetch_extra_cities_are_split_by_month_and_chunked() -> None:
    # 取り直す期間がなく、市別だけを補う月が 5 つ → G9 を 4 つと 1 つで送る
    months = (
        Period("m2025-10", "month", date(2025, 10, 1), date(2025, 10, 31), True),
        Period("m2025-11", "month", date(2025, 11, 1), date(2025, 11, 30), True),
        Period("m2025-12", "month", date(2025, 12, 1), date(2025, 12, 31), True),
        Period("m2026-01", "month", date(2026, 1, 1), date(2026, 1, 31), True),
        Period("m2026-02", "month", date(2026, 2, 1), date(2026, 2, 28), True),
    )
    plan = PeriodPlan(
        base_date=date(2026, 3, 20),
        refetch=(),
        all_periods=months,
        referrer_months=(),
        city_months=months,
        city_extra_months=months,
    )
    responses: FakeResponses = {
        "G9": {
            "m2025-10": [
                ({"country": "Japan", "region": "Kanagawa", "city": "Kawasaki"}, {"sessions": "40"})
            ],
            "m2025-11": [
                ({"country": "Japan", "region": "Kanagawa", "city": "Kawasaki"}, {"sessions": "41"})
            ],
            # 2025-12 と 2026-01 は行がない
            "m2026-02": [
                ({"country": "Japan", "region": "Tokyo", "city": "Shibuya"}, {"sessions": "12"})
            ],
        }
    }
    fake = FakeGa4(responses)
    result = ga4_period.fetch(_client(fake), plan, {}, {}, date(2026, 3, 20), full=False)

    assert _ranges_by_query(fake) == {
        "G9": [("m2025-10", "m2025-11", "m2025-12", "m2026-01"), ("m2026-02",)]
    }
    assert _plain(result.extra_cities) == {
        "m2025-10": {("Kanagawa", "Kawasaki"): 40},
        "m2025-11": {("Kanagawa", "Kawasaki"): 41},
        "m2025-12": {},
        "m2026-01": {},
        "m2026-02": {("Tokyo", "Shibuya"): 12},
    }
    # 取り直す期間も、参照元も、記事もない
    assert result.periods == {}
    assert result.month_referrers == {}
    assert result.article_referrers == {}
