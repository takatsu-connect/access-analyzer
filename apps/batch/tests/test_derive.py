"""U-06、U-09〜U-12: 派生指標と、derive() の端から端（03 §6、02 §3、05 §4.1）。

フィクスチャの記事、著者、参照元、数値はすべて架空。期待値は手計算して直書きする。
"""

from collections import Counter
from collections.abc import Mapping, Sequence
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

import pytest

from takatsu_batch.config import (
    CHANNEL_BUCKETS,
    DEVICE_BUCKETS,
    HEATMAP_BUCKETS,
    LOCAL_BUCKETS,
    NEW_RETURNING_BUCKETS,
    SNS_BUCKETS,
)
from takatsu_batch.db import AuthorRow, DeriveInputs, PostRow, PriorState
from takatsu_batch.derive import (
    DbRow,
    DeriveOutput,
    _merged_article_daily,
    _site_days_with_gaps_filled,
    cumulative,
    derive,
    freshness,
    is_evergreen_365,
    is_recent_hot,
    is_revival,
    milestones,
    own_median_30d,
)
from takatsu_batch.ga4_daily import DailyRaw
from takatsu_batch.ga4_period import PeriodFetch, PeriodRaw
from takatsu_batch.period import PeriodPlan, plan_periods
from takatsu_batch.wp_fetch import WpResult

type Cell = tuple[int | None, str | None]

D0 = date(2026, 1, 1)


def _day(offset: int) -> date:
    return D0 + timedelta(days=offset)


# --- U-06: 累積 ---


def test_cumulative_starts_on_publish_day_and_fills_missing_days_with_zero() -> None:
    daily = {date(2026, 10, 1): 3, date(2026, 10, 3): 2}
    # 添字 0 が公開日（1 日目）。10-02 と 10-04 は行がないので 0 を足す
    assert cumulative(daily, date(2026, 10, 1), date(2026, 10, 4)) == [3, 3, 5, 5]


def test_cumulative_on_publish_day_has_one_entry() -> None:
    assert cumulative({D0: 7}, D0, D0) == [7]
    assert cumulative({}, D0, D0) == [0]


@pytest.mark.parametrize(
    ("days_since_publish", "expected_length"),
    [(0, 1), (88, 89), (89, 90), (90, 90), (300, 90)],
)
def test_cumulative_is_capped_at_90_days(days_since_publish: int, expected_length: int) -> None:
    daily = {_day(offset): 1 for offset in range(400)}
    result = cumulative(daily, D0, _day(days_since_publish))
    assert len(result) == expected_length
    assert result[-1] == expected_length


def test_cumulative_ignores_days_before_publish_and_after_day_90() -> None:
    daily = {_day(-1): 99, _day(0): 1, _day(89): 2, _day(90): 50}
    result = cumulative(daily, D0, _day(200))
    assert len(result) == 90
    assert result[0] == 1
    assert result[88] == 1
    assert result[89] == 3


def test_cumulative_is_empty_when_published_after_base_date() -> None:
    # 基準日の翌日（実行日の当日）に公開された記事
    assert cumulative({_day(1): 5}, _day(1), D0) == []


# --- U-09: 鮮度区分 ---


@pytest.mark.parametrize(
    ("days_since_publish", "expected"),
    [(0, "new"), (30, "new"), (31, "mid"), (90, "mid"), (91, "long"), (365, "long")],
)
def test_freshness(days_since_publish: int, expected: str) -> None:
    assert freshness(days_since_publish) == expected


# --- U-10: 最近読まれている、再注目 ---


@pytest.mark.parametrize(
    ("days_since_publish", "pv_recent_7d", "pv_prior_28d", "expected"),
    [
        # 基準日 − 公開日 が 15 日以上
        (14, 20, 0, False),
        (15, 20, 0, True),
        # 直近 7 日が 20 以上
        (15, 19, 0, False),
        (15, 20, 0, True),
        # 前 28 日の週平均の 2 倍以上（前 28 日 40 → 週平均 10 → ちょうど 2.0 倍）
        (15, 20, 40, True),
        (15, 20, 41, False),
        # 1.99 倍と 2.0 倍（前 28 日 400 → 週平均 100）
        (100, 199, 400, False),
        (100, 200, 400, True),
        (100, 201, 400, True),
        # 条件が 1 つでも欠ければ false
        (14, 500, 0, False),
        (500, 19, 0, False),
        (500, 20, 1000, False),
    ],
)
def test_is_recent_hot(
    days_since_publish: int, pv_recent_7d: int, pv_prior_28d: int, expected: bool
) -> None:
    assert is_recent_hot(days_since_publish, pv_recent_7d, pv_prior_28d) is expected


@pytest.mark.parametrize(
    ("days_since_publish", "recent_hot", "expected"),
    [(90, True, False), (91, True, True), (91, False, False), (400, True, True)],
)
def test_is_revival(days_since_publish: int, recent_hot: bool, expected: bool) -> None:
    assert is_revival(days_since_publish, recent_hot) is expected


# --- U-11: 節目、長く読まれている ---


@pytest.mark.parametrize(
    ("daily", "expected"),
    [
        ({}, {}),
        ({_day(0): 499}, {}),
        ({_day(0): 500}, {500: _day(0)}),
        ({_day(0): 499, _day(1): 1}, {500: _day(1)}),
        # 同じ日に 2 つ超えたら両方
        ({_day(0): 400, _day(2): 700}, {500: _day(2), 1000: _day(2)}),
        ({_day(0): 10000}, {500: _day(0), 1000: _day(0), 5000: _day(0), 10000: _day(0)}),
        # 節目ごとに別の日
        (
            {_day(0): 500, _day(1): 500, _day(5): 4000, _day(9): 5000},
            {500: _day(0), 1000: _day(1), 5000: _day(5), 10000: _day(9)},
        ),
        # 1 足りない（累積 4,999）
        ({_day(0): 999, _day(1): 3999, _day(2): 1}, {500: _day(0), 1000: _day(1)}),
        # 入力の順ではなく日付の順に累積する
        ({_day(1): 300, _day(0): 300}, {500: _day(1)}),
    ],
)
def test_milestones(daily: dict[date, int], expected: dict[int, date]) -> None:
    assert milestones(daily) == expected


@pytest.mark.parametrize(
    ("days_since_publish", "pv_recent_28d", "expected"),
    [(364, 20, False), (365, 20, True), (365, 19, False), (364, 500, False), (1000, 20, True)],
)
def test_is_evergreen_365(days_since_publish: int, pv_recent_28d: int, expected: bool) -> None:
    assert is_evergreen_365(days_since_publish, pv_recent_28d) is expected


# --- U-12: 自分の過去の記事の中央値 ---


@pytest.mark.parametrize(
    ("values", "expected"),
    [
        ([], None),
        ([10, 20, 30, 40], None),
        ([50, 10, 40, 20, 30], Decimal(30)),
        # 偶数本は中央 2 本の平均で .5 になりうる
        ([1, 2, 3, 4, 5, 6], Decimal("3.5")),
        ([10, 20, 30, 50, 60, 70], Decimal(40)),
        ([7, 7, 7, 7, 7], Decimal(7)),
    ],
)
def test_own_median_30d(values: list[int], expected: Decimal | None) -> None:
    result = own_median_30d(values)
    assert result == expected
    assert result is None or isinstance(result, Decimal)


# --- derive() の端から端 ---

BASE = date(2026, 11, 7)
# 取り直す直近 7 日（2026-11-01〜11-07）
D1, D2, D3, D4, D5, D6, D7 = (date(2026, 11, day) for day in range(1, 8))
REFETCHED_DAYS = (D1, D2, D3, D4, D5, D6, D7)
# 前回までに確定している月（2025-10〜2026-09）。2026-10 は今回の基準日で確定する
PRIOR_CONFIRMED = (
    "m2025-10",
    "m2025-11",
    "m2025-12",
    "m2026-01",
    "m2026-02",
    "m2026-03",
    "m2026-04",
    "m2026-05",
    "m2026-06",
    "m2026-07",
    "m2026-08",
    "m2026-09",
)
REFETCH_IDS = ("last7", "prev7", "last28", "prev28", "last90", "prev90", "m2026-10", "m2026-11")
# 記事 × 期間の pageviews（記事 101、202、303 の順）。merged daily の期間内合計を手計算した値
PERIOD_PAGEVIEWS = {
    "last7": (5, 21, 11),
    "prev7": (0, 8, 19),
    "last28": (65, 29, 30),
    "prev28": (0, 934, 0),
    "last90": (215, 1122, 30),
    "prev90": (0, 0, 0),
    "m2026-10": (60, 42, 19),
    "m2026-11": (5, 21, 11),
}
POST_IDS = (101, 202, 303)


def _post(post_id: int, author_slug: str, published_on: date, *, is_ad: bool = False) -> PostRow:
    published_at = datetime(
        published_on.year, published_on.month, published_on.day, 3, 0, tzinfo=UTC
    )
    return PostRow(
        post_id=post_id,
        title=f"架空の記事 {post_id}",
        post_url=f"https://example.invalid/{post_id}/",
        author_slug=author_slug,
        published_at=published_at,
        published_on=published_on,
        modified_at=published_at,
        is_ad=is_ad,
        first_seen_on=published_on,
    )


def _wp(posts: Sequence[PostRow]) -> WpResult:
    authors = {
        slug: AuthorRow(
            author_slug=slug,
            display_name=f"架空の著者 {slug}",
            author_url=f"https://example.invalid/author/{slug}/",
            first_seen_on=date(2025, 10, 8),
        )
        for slug in sorted({post.author_slug for post in posts})
    }
    return WpResult(
        posts={post.post_id: post for post in posts},
        changed_posts=(),
        deleted_post_ids=frozenset(),
        authors=authors,
        categories=(),
        tags=(),
        post_categories=frozenset(),
        post_tags=frozenset(),
        requests=0,
    )


def _prior(referrer_computed: dict[int, date]) -> PriorState:
    return PriorState(
        last_success_started_at=None,
        posts={},
        authors={},
        post_categories=frozenset(),
        post_tags=frozenset(),
        confirmed_months=frozenset(PRIOR_CONFIRMED),
        referrer_months=frozenset(),
        city_months=frozenset(),
        referrer_computed=referrer_computed,
    )


def _plan() -> PeriodPlan:
    """基準日 2026-11-07。2026-08 は参照元と市別、2026-07 は市別の行がまだない。"""
    return plan_periods(
        BASE,
        prior_confirmed=PRIOR_CONFIRMED,
        referrer_months=[m for m in PRIOR_CONFIRMED if m != "m2026-08"],
        city_months=[m for m in PRIOR_CONFIRMED if m not in {"m2026-07", "m2026-08"}],
        full=False,
    )


def _posts() -> list[PostRow]:
    return [
        # 計測開始（2025-10-08）より前の公開
        _post(101, "aoi", date(2025, 9, 20)),
        # 広告。基準日 − 公開日 = 67
        _post(202, "aoi", date(2026, 9, 1), is_ad=True),
        # 広告でなく直近。基準日 − 公開日 = 10
        _post(303, "minato", date(2026, 10, 28)),
    ]


def _daily() -> DailyRaw:
    raw = DailyRaw(start=D1, end=D7)
    # 並べ替えを確かめるため、新しい日から入れる
    for index, day in reversed(list(enumerate(REFETCHED_DAYS))):
        raw.site[day] = (100 + 10 * index, 50 + index)
    raw.channel[D1].update({"search": 30, "social": 3, "direct": 10, "other": 7})
    raw.channel[D2].update({"search": 12, "social": 2, "direct": 4})
    raw.device_pv[D1].update({"mobile": 80, "desktop": 15, "tablet": 4})
    raw.device_sessions[D1].update({"mobile": 40, "desktop": 9})
    raw.article.update({(303, D2): 6, (303, D1): 5, (101, D7): 3, (101, D1): 2})
    raw.article.update({(202, day): 3 for day in REFETCHED_DAYS})
    return raw


def _stored_article_daily() -> dict[tuple[int, date], int]:
    return {
        (101, date(2025, 9, 10)): 40,  # 公開前
        (101, date(2025, 10, 10)): 300,
        (101, date(2026, 8, 15)): 150,
        (101, date(2026, 10, 20)): 60,
        (101, D3): 77,  # 取り直した日。今回の取得に行がないので消える
        (202, date(2026, 8, 31)): 9,  # 公開前
        (202, date(2026, 9, 1)): 100,
        (202, date(2026, 9, 3)): 50,
        (202, date(2026, 9, 20)): 900,
        (202, date(2026, 10, 5)): 34,
        (202, date(2026, 10, 30)): 8,
        (202, D1): 99,  # 取り直した日。今回の値 3 に置き換わる
        (303, date(2026, 10, 27)): 4,  # 公開前
        (303, date(2026, 10, 28)): 10,
        (303, date(2026, 10, 30)): 5,
        (999, date(2026, 10, 30)): 500,  # posts にない記事
    }


def _fetched(plan: PeriodPlan) -> PeriodFetch:
    periods = {period.period_id: PeriodRaw() for period in plan.refetch}
    last7 = periods["last7"]
    last7.active_users = 3
    last7.engagement_seconds = 1234
    last7.sns.update({"instagram": 12, "facebook": 3, "line": 6, "other": 1})
    last7.new_returning.update({"new": 30, "returning": 4})
    last7.local.update({"kawasaki": 20, "japan_other": 15, "unknown": 5})
    last7.channel.update({"search": 40, "social": 22, "direct": 9, "referral": 5, "other": 2})
    last7.device_pv.update({"mobile": 70, "desktop": 20})
    last7.device_sessions.update({"mobile": 33, "desktop": 4, "tablet": 4})
    # (7, 0) は曜日の範囲外なので捨てられる
    last7.heatmap.update({(0, 0): 10, (3, 14): 2, (6, 23): 7, (7, 0): 99})
    last7.landing_sessions.update({202: 12, 303: 3})
    last7.scroll_by_post.update({202: 4, 303: 7})
    last7.engagement_by_post.update({101: 2, 202: 600})
    last7.article_channel[101].update({"search": 7, "direct": 5})
    last7.article_channel[202].update({"search": 10, "social": 8, "direct": 6})
    last7.article_channel[303].update({"search": 6, "social": 5})
    last7.article_channel[999].update({"search": 50})  # posts にない記事
    last7.article_sns[101].update({"instagram": 4, "line": 6})
    last7.article_sns[202].update({"instagram": 10, "facebook": 7, "line": 9})
    last7.article_device[202].update({"mobile": 15, "desktop": 5, "tablet": 1})
    last7.article_device[303].update({"mobile": 3, "desktop": 2})
    last7.unmapped_sources.update({"newsns.example": 3})
    last7.cities.update({("Kanagawa", "Kawasaki"): 9})  # 月でないので格納されない

    periods["last28"].active_users = 250
    periods["last28"].engagement_seconds = 9000
    periods["last28"].unmapped_sources.update({"newsns.example": 8, "othersns.example": 6})

    october = periods["m2026-10"]
    october.active_users = 5
    october.landing_sessions.update({101: 1, 202: 4, 303: 5})
    october.unmapped_sources.update({"othersns.example": 20, "zzz.example": 1})
    october.cities.update(
        {("Kanagawa", "Kawasaki"): 55, ("Chiba", "Chiba"): 5, ("Aichi", "Nagoya"): 2}
    )
    periods["m2026-11"].cities.update({("Kanagawa", "Kawasaki"): 9})  # 未確定の月

    return PeriodFetch(
        periods=periods,
        # 2026-07 も city_extra_months だが、取得できなかったものとして入れない
        extra_cities={
            "m2026-08": Counter(
                {
                    ("Tokyo", "Setagaya"): 12,
                    ("Kanagawa", "Yokohama"): 12,
                    ("Kanagawa", "Kawasaki"): 40,
                    ("Osaka", "Osaka"): 4,
                }
            )
        },
        month_referrers={
            "m2026-08": Counter(
                {
                    "site-k.example": 11,
                    "site-b.example": 20,
                    "site-a.example": 20,
                    "site-c.example": 19,
                    "site-d.example": 18,
                    "site-e.example": 17,
                    "site-f.example": 16,
                    "site-g.example": 15,
                    "site-h.example": 14,
                    "site-i.example": 13,
                    "site-j.example": 12,
                    "site-l.example": 3,
                }
            ),
            "m2026-10": Counter({"x.example": 5, "y.example": 4, "z.example": 100}),
        },
        article_referrers={
            202: Counter(
                {
                    "bravo.example": 9,
                    "alpha.example": 9,
                    "charlie.example": 30,
                    "delta.example": 6,
                    "echo.example": 4,
                }
            )
        },
    )


def _inputs() -> DeriveInputs:
    # 取り直さない確定月（2025-10〜2026-09）のうち、行がまだないのは
    # (202, 2026-09)、(303, 2026-08)、(303, 2026-09) の 3 つ
    missing = {(202, "m2026-09"), (303, "m2026-08"), (303, "m2026-09")}
    keys = {(post_id, month) for post_id in POST_IDS for month in PRIOR_CONFIRMED} - missing
    return DeriveInputs(article_daily=_stored_article_daily(), article_period_keys=frozenset(keys))


def _run() -> DeriveOutput:
    plan = _plan()
    return derive(
        _wp(_posts()),
        plan,
        _daily(),
        _fetched(plan),
        _inputs(),
        _prior({101: date(2025, 10, 27)}),
        BASE,
    )


@pytest.fixture(scope="module")
def out() -> DeriveOutput:
    return _run()


def _rows(
    prefix: tuple[object, ...], buckets: Sequence[object], cells: Mapping[object, Cell]
) -> list[DbRow]:
    """全バケットの行を固定順で作る。cells にないバケットは 0（伏せなし）。"""
    return [(*prefix, bucket, *cells.get(bucket, (0, None))) for bucket in buckets]


def _of_period(rows: Sequence[DbRow], period_id: str, column: int) -> list[DbRow]:
    return [row for row in rows if row[column] == period_id]


def test_derive_period_rows_are_the_refetched_periods(out: DeriveOutput) -> None:
    assert out.period_rows == [
        ("last7", "window", date(2026, 11, 1), date(2026, 11, 7), BASE, False),
        ("prev7", "window", date(2026, 10, 25), date(2026, 10, 31), BASE, False),
        ("last28", "window", date(2026, 10, 11), date(2026, 11, 7), BASE, False),
        ("prev28", "window", date(2026, 9, 13), date(2026, 10, 10), BASE, False),
        ("last90", "window", date(2026, 8, 10), date(2026, 11, 7), BASE, False),
        ("prev90", "window", date(2026, 5, 12), date(2026, 8, 9), BASE, False),
        ("m2026-10", "month", date(2026, 10, 1), date(2026, 10, 31), BASE, True),
        ("m2026-11", "month", date(2026, 11, 1), date(2026, 11, 7), BASE, False),
    ]
    assert out.refetched_period_ids == list(REFETCH_IDS)


def test_derive_site_daily_and_article_daily(out: DeriveOutput) -> None:
    assert out.site_daily == [
        (D1, 100, 50),
        (D2, 110, 51),
        (D3, 120, 52),
        (D4, 130, 53),
        (D5, 140, 54),
        (D6, 150, 55),
        (D7, 160, 56),
    ]
    assert out.article_daily_scope_days == list(REFETCHED_DAYS)
    assert out.article_daily == [
        (101, D1, 2),
        (101, D7, 3),
        *((202, day, 3) for day in REFETCHED_DAYS),
        (303, D1, 5),
        (303, D2, 6),
    ]


def test_derive_site_daily_channel_has_all_buckets_per_day(out: DeriveOutput) -> None:
    assert out.site_daily_channel == [
        # 伏せが 1 つ（social）なので、5 以上で最小の other を二次伏せ
        (D1, "search", 30, None),
        (D1, "social", None, "threshold"),
        (D1, "direct", 10, None),
        (D1, "referral", 0, None),
        (D1, "other", None, "secondary"),
        # 伏せが 2 つなので二次伏せなし
        (D2, "search", 12, None),
        (D2, "social", None, "threshold"),
        (D2, "direct", None, "threshold"),
        (D2, "referral", 0, None),
        (D2, "other", 0, None),
        # 内訳の行がない日も 5 区分を 0 で揃える
        *(row for day in (D3, D4, D5, D6, D7) for row in _rows((day,), CHANNEL_BUCKETS, {})),
    ]


def test_derive_site_daily_device_has_all_buckets_per_day(out: DeriveOutput) -> None:
    assert out.site_daily_device == [
        (D1, "mobile", 80, None, 40, None),
        (D1, "desktop", None, "secondary", 9, None),
        (D1, "tablet", None, "threshold", 0, None),
        *(
            (day, device, 0, None, 0, None)
            for day in (D2, D3, D4, D5, D6, D7)
            for device in DEVICE_BUCKETS
        ),
    ]


def test_derive_site_period(out: DeriveOutput) -> None:
    assert out.site_period == [
        ("last7", 1234, None, "threshold"),
        ("prev7", 0, 0, None),
        ("last28", 9000, 250, None),
        ("prev28", 0, 0, None),
        ("last90", 0, 0, None),
        ("prev90", 0, 0, None),
        ("m2026-10", 0, 5, None),
        ("m2026-11", 0, 0, None),
    ]


def test_derive_site_period_breakdown_has_six_axes_per_period(out: DeriveOutput) -> None:
    assert _of_period(out.site_period_breakdown, "last7", 0) == [
        *_rows(
            ("last7", "sns"),
            SNS_BUCKETS,
            {
                "instagram": (12, None),
                "facebook": (None, "threshold"),
                "line": (6, None),
                "other": (None, "threshold"),
            },
        ),
        *_rows(
            ("last7", "new_returning"),
            NEW_RETURNING_BUCKETS,
            {"new": (None, "secondary"), "returning": (None, "threshold")},
        ),
        *_rows(
            ("last7", "local"),
            LOCAL_BUCKETS,
            {"kawasaki": (20, None), "japan_other": (15, None), "unknown": (5, None)},
        ),
        *_rows(
            ("last7", "channel"),
            CHANNEL_BUCKETS,
            {
                "search": (40, None),
                "social": (22, None),
                "direct": (9, None),
                "referral": (None, "secondary"),
                "other": (None, "threshold"),
            },
        ),
        *_rows(
            ("last7", "device_pv"), DEVICE_BUCKETS, {"mobile": (70, None), "desktop": (20, None)}
        ),
        *_rows(
            ("last7", "device_sessions"),
            DEVICE_BUCKETS,
            {
                "mobile": (33, None),
                "desktop": (None, "threshold"),
                "tablet": (None, "threshold"),
            },
        ),
    ]
    # 値のない期間も 6 軸の全バケット（5 + 3 + 3 + 5 + 3 + 3 = 22 行）を 0 で揃える
    for period_id in REFETCH_IDS[1:]:
        assert _of_period(out.site_period_breakdown, period_id, 0) == [
            *_rows((period_id, "sns"), SNS_BUCKETS, {}),
            *_rows((period_id, "new_returning"), NEW_RETURNING_BUCKETS, {}),
            *_rows((period_id, "local"), LOCAL_BUCKETS, {}),
            *_rows((period_id, "channel"), CHANNEL_BUCKETS, {}),
            *_rows((period_id, "device_pv"), DEVICE_BUCKETS, {}),
            *_rows((period_id, "device_sessions"), DEVICE_BUCKETS, {}),
        ]
    assert len(out.site_period_breakdown) == 22 * 8
    assert [row[0] for row in out.site_period_breakdown[::22]] == list(REFETCH_IDS)


def test_derive_site_period_heatmap_has_168_cells_per_period(out: DeriveOutput) -> None:
    cells: dict[tuple[int, int], Cell] = {
        (0, 0): (10, None),
        (3, 14): (None, "threshold"),
        # 伏せが 1 つなので、5 以上で最小の (6, 23) を二次伏せ
        (6, 23): (None, "secondary"),
    }
    last7 = _of_period(out.site_period_heatmap, "last7", 0)
    assert len(last7) == 168
    assert last7 == [
        ("last7", dow, hour, *cells.get((dow, hour), (0, None))) for dow, hour in HEATMAP_BUCKETS
    ]
    for period_id in REFETCH_IDS[1:]:
        assert _of_period(out.site_period_heatmap, period_id, 0) == [
            (period_id, dow, hour, 0, None) for dow, hour in HEATMAP_BUCKETS
        ]
    assert len(out.site_period_heatmap) == 168 * 8


def test_derive_article_period_for_refetched_periods(out: DeriveOutput) -> None:
    refetched = out.article_period[:24]
    # 取り直す 8 期間 × 全 3 記事。期間は refetch の順、記事は ID の順
    assert [(row[1], row[0]) for row in refetched] == [
        (period_id, post_id) for period_id in REFETCH_IDS for post_id in POST_IDS
    ]
    # pageviews は merged daily の期間内合計（公開前の日の値も含む）
    assert {
        period_id: tuple(row[2] for row in _of_period(refetched, period_id, 1))
        for period_id in REFETCH_IDS
    } == PERIOD_PAGEVIEWS
    # landing / scroll / engagement は 1〜4 なら None と "threshold"、0 と 5 以上はそのまま
    assert _of_period(refetched, "last7", 1) == [
        (101, "last7", 5, 0, None, 0, None, None, "threshold"),
        (202, "last7", 21, 12, None, None, "threshold", 600, None),
        (303, "last7", 11, None, "threshold", 7, None, 0, None),
    ]
    assert _of_period(refetched, "m2026-10", 1) == [
        (101, "m2026-10", 60, None, "threshold", 0, None, 0, None),
        (202, "m2026-10", 42, None, "threshold", 0, None, 0, None),
        (303, "m2026-10", 19, 5, None, 0, None, 0, None),
    ]
    # GA4 に行がない期間は 0（伏せなし）
    for period_id in ("prev7", "last28", "prev28", "last90", "prev90", "m2026-11"):
        assert [row[3:] for row in _of_period(refetched, period_id, 1)] == [
            (0, None, 0, None, 0, None)
        ] * 3


def test_derive_adds_empty_article_period_rows_for_untouched_months(out: DeriveOutput) -> None:
    # 取り直さない確定月のうち、article_period_keys にない (記事, 月) だけを 0 で足す。
    # pageviews は merged daily から計算する（202 の 2026-09 は 100 + 50 + 900）
    assert out.article_period[24:] == [
        (303, "m2026-08", 0, 0, None, 0, None, 0, None),
        (202, "m2026-09", 1050, 0, None, 0, None, 0, None),
        (303, "m2026-09", 0, 0, None, 0, None, 0, None),
    ]


def test_derive_article_period_breakdown_has_three_axes(out: DeriveOutput) -> None:
    assert _of_period(out.article_period_breakdown, "last7", 1) == [
        *_rows(
            (101, "last7", "channel"), CHANNEL_BUCKETS, {"search": (7, None), "direct": (5, None)}
        ),
        *_rows(
            (202, "last7", "channel"),
            CHANNEL_BUCKETS,
            {"search": (10, None), "social": (8, None), "direct": (6, None)},
        ),
        *_rows(
            (303, "last7", "channel"), CHANNEL_BUCKETS, {"search": (6, None), "social": (5, None)}
        ),
        # instagram 4 を伏せ、伏せが 1 つなので line 6 を二次伏せ
        *_rows(
            (101, "last7", "sns"),
            SNS_BUCKETS,
            {"instagram": (None, "threshold"), "line": (None, "secondary")},
        ),
        *_rows(
            (202, "last7", "sns"),
            SNS_BUCKETS,
            {"instagram": (10, None), "facebook": (7, None), "line": (9, None)},
        ),
        *_rows((303, "last7", "sns"), SNS_BUCKETS, {}),
        *_rows((101, "last7", "device"), DEVICE_BUCKETS, {}),
        *_rows(
            (202, "last7", "device"),
            DEVICE_BUCKETS,
            {
                "mobile": (15, None),
                "desktop": (None, "secondary"),
                "tablet": (None, "threshold"),
            },
        ),
        *_rows(
            (303, "last7", "device"),
            DEVICE_BUCKETS,
            {"mobile": (None, "threshold"), "desktop": (None, "threshold")},
        ),
    ]
    # 3 記事 × (5 + 5 + 3) バケット × 8 期間。posts にない 999 の行はない
    assert len(out.article_period_breakdown) == 3 * 13 * 8
    assert {row[0] for row in out.article_period_breakdown} == set(POST_IDS)
    assert {row[2] for row in out.article_period_breakdown} == {"channel", "sns", "device"}
    assert all(row[4:] == (0, None) for row in out.article_period_breakdown if row[1] != "last7")


def test_derive_author_period_breakdown_sums_articles_and_has_no_device(
    out: DeriveOutput,
) -> None:
    assert _of_period(out.author_period_breakdown, "last7", 1) == [
        # aoi = 記事 101 + 202 の合算（search 7 + 10、social 0 + 8、direct 5 + 6）
        *_rows(
            ("aoi", "last7", "channel"),
            CHANNEL_BUCKETS,
            {"search": (17, None), "social": (8, None), "direct": (11, None)},
        ),
        *_rows(
            ("minato", "last7", "channel"),
            CHANNEL_BUCKETS,
            {"search": (6, None), "social": (5, None)},
        ),
        # 合算は instagram 14、facebook 7、line 15 だが、記事 101 だけが instagram と line を
        # 伏せているので、著者のセルも階層差分で伏せる（03 §6.1 手順 5）
        *_rows(
            ("aoi", "last7", "sns"),
            SNS_BUCKETS,
            {
                "instagram": (None, "secondary"),
                "facebook": (7, None),
                "line": (None, "secondary"),
            },
        ),
        *_rows(("minato", "last7", "sns"), SNS_BUCKETS, {}),
    ]
    # 著者 × デバイスは格納しない（05 §4.1）
    assert {row[2] for row in out.author_period_breakdown} == {"channel", "sns"}
    assert {row[0] for row in out.author_period_breakdown} == {"aoi", "minato"}
    assert len(out.author_period_breakdown) == 2 * (5 + 5) * 8
    assert all(row[4:] == (0, None) for row in out.author_period_breakdown if row[1] != "last7")


def test_derive_month_referrers_keep_top_10_above_threshold(out: DeriveOutput) -> None:
    assert out.referrer_scope_months == ["m2026-08", "m2026-10"]
    assert out.site_month_referrer == [
        # 多い順。同値（20）は名前の順。11 位（site-k）と 5 未満（site-l）は落ちる
        ("m2026-08", 1, "site-a.example", 20),
        ("m2026-08", 2, "site-b.example", 20),
        ("m2026-08", 3, "site-c.example", 19),
        ("m2026-08", 4, "site-d.example", 18),
        ("m2026-08", 5, "site-e.example", 17),
        ("m2026-08", 6, "site-f.example", 16),
        ("m2026-08", 7, "site-g.example", 15),
        ("m2026-08", 8, "site-h.example", 14),
        ("m2026-08", 9, "site-i.example", 13),
        ("m2026-08", 10, "site-j.example", 12),
        # 5 はちょうど T なので残り、4 は落ちる
        ("m2026-10", 1, "z.example", 100),
        ("m2026-10", 2, "x.example", 5),
    ]


def test_derive_month_cities_only_for_fetched_city_months(out: DeriveOutput) -> None:
    # city_months は 2026-07、2026-08、2026-10。2026-07 は取得がないので飛ばす。
    # 2026-08 は extra_cities、2026-10 は取り直した期間の cities から作る。
    # 月でない last7 と未確定の 2026-11 の cities は格納しない
    assert out.city_scope_months == ["m2026-08", "m2026-10"]
    assert out.site_month_city == [
        ("m2026-08", 1, "Japan", "Kanagawa", "Kawasaki", 40),
        ("m2026-08", 2, "Japan", "Kanagawa", "Yokohama", 12),
        ("m2026-08", 3, "Japan", "Tokyo", "Setagaya", 12),
        ("m2026-10", 1, "Japan", "Kanagawa", "Kawasaki", 55),
        ("m2026-10", 2, "Japan", "Chiba", "Chiba", 5),
    ]


def test_derive_article_referrers_keep_top_3(out: DeriveOutput) -> None:
    assert out.referrer_scope_posts == [202]
    assert out.article_referrer_30d == [
        (202, 1, "charlie.example", 30, BASE),
        (202, 2, "alpha.example", 9, BASE),
        (202, 3, "bravo.example", 9, BASE),
    ]


def test_derive_article_summary(out: DeriveOutput) -> None:
    # 列順: post_id, base_date, age_days, freshness, pv_7d, pv_30d, pv_total,
    #       is_recent_hot, is_revival, is_evergreen_365, referrer_30d_computed_on
    assert out.article_summary == [
        # 計測開始前の公開: pv_7d / pv_30d は None。pv_total は公開日以降（公開前の 40 と、
        # 取り直した日の古い値 77 を含めない）。直近 28 日 65 ≥ 20 で evergreen。
        # referrer_30d_computed_on は前回までの値
        (101, BASE, 414, "long", None, None, 515, False, False, True, date(2025, 10, 27)),
        # 直近 7 日 21、前 28 日 42 でちょうど 2.0 倍。今回参照元を計算したので基準日が入る
        (202, BASE, 68, "mid", 150, 1050, 1113, True, False, False, BASE),
        # age_days 11 なので pv_30d はまだない。公開前の 4 を含めない
        (303, BASE, 11, "new", 26, None, 26, False, False, False, None),
    ]


def test_derive_article_milestone(out: DeriveOutput) -> None:
    assert out.article_milestone == [
        (101, 500, date(2026, 10, 20)),
        # 同じ日に 500 と 1,000 を超えた
        (202, 500, date(2026, 9, 20)),
        (202, 1000, date(2026, 9, 20)),
    ]


def test_derive_author_summary_has_one_row_per_author(out: DeriveOutput) -> None:
    # aoi: 101 は pv_30d が None、202 の 1 本だけ → 5 本未満で None。minato: 該当なし
    # aoi の 30 日の値がある記事は広告の 202 だけで、M-24 には入れない（助言 B-5）ので 0 本。
    assert out.author_summary == [("aoi", BASE, None, 0), ("minato", BASE, None, 0)]


def test_derive_sns_source_unmapped_takes_the_narrowest_period(out: DeriveOutput) -> None:
    assert out.sns_source_unmapped == [
        ("newsns.example", BASE, BASE, 3),  # last7 の値（last28 の 8 ではない）
        ("othersns.example", BASE, BASE, 6),  # last28 の値（2026-10 の 20 ではない）
        # zzz.example は 2026-10 にしか現れない。基準日で終わる期間ではないので、
        # last_seen_on を基準日にして残すことはしない
    ]


def test_derive_is_repeatable_and_does_not_change_its_inputs() -> None:
    plan = _plan()
    wp, daily, fetched, inputs = _wp(_posts()), _daily(), _fetched(plan), _inputs()
    prior = _prior({101: date(2025, 10, 27)})
    first = derive(wp, plan, daily, fetched, inputs, prior, BASE)
    second = derive(wp, plan, daily, fetched, inputs, prior, BASE)
    assert first == second
    assert first == _run()
    assert prior.referrer_computed == {101: date(2025, 10, 27)}


def _empty_run(posts: Sequence[PostRow], stored: dict[tuple[int, date], int]) -> DeriveOutput:
    """GA4 の値がすべて空の実行。取り直した日がないので、内部表の値がそのまま使われる。"""
    plan = _plan()
    return derive(
        _wp(posts),
        plan,
        DailyRaw(start=D1, end=D7),
        PeriodFetch(periods={period.period_id: PeriodRaw() for period in plan.refetch}),
        DeriveInputs(article_daily=stored, article_period_keys=frozenset()),
        _prior({}),
        BASE,
    )


def test_derive_leaves_out_posts_published_after_base_date() -> None:
    """基準日より後に公開された記事は、集計の行を作らない（基準日を過去にした実行）。"""
    posts = [_post(31, "aoi", BASE), _post(32, "aoi", BASE + timedelta(days=1))]
    result = _empty_run(posts, {(32, BASE): 5})
    assert [row[0] for row in result.article_summary] == [31]
    # age_days は公開日が 1 日目。0 以下の行は作らない
    assert [row[2] for row in result.article_summary] == [1]
    assert {row[0] for row in result.article_period} == {31}
    assert {row[0] for row in result.article_period_breakdown} == {31}
    # WP の表には残す（消さない）
    assert set(result.wp.posts) == {31, 32}


def test_derive_author_summary_own_median_uses_recent_posts_with_pv_30d() -> None:
    posts = [
        _post(11, "aoi", date(2025, 11, 7)),  # 基準日 − 365 日ちょうど → 対象
        _post(12, "aoi", date(2025, 11, 6)),  # 基準日 − 366 日 → 対象外
        _post(13, "aoi", date(2026, 1, 10)),
        _post(14, "aoi", date(2026, 3, 10)),
        _post(15, "aoi", date(2026, 5, 10)),
        _post(16, "aoi", date(2026, 10, 9)),  # age_days 30 → pv_30d あり
        _post(17, "aoi", date(2026, 10, 10)),  # age_days 29 → pv_30d なし
        _post(21, "minato", date(2026, 1, 1)),
    ]
    stored = {
        (11, date(2025, 11, 7)): 10,
        (12, date(2025, 11, 6)): 1000,
        (13, date(2026, 1, 10)): 20,
        (14, date(2026, 3, 10)): 30,
        (15, date(2026, 5, 10)): 40,
        (16, date(2026, 10, 9)): 50,
        (17, date(2026, 10, 10)): 9999,
        (21, date(2026, 1, 1)): 7,
    }
    result = _empty_run(posts, stored)
    assert {row[0]: (row[2], row[5]) for row in result.article_summary} == {
        11: (366, 10),
        12: (367, 1000),
        13: (302, 20),
        14: (243, 30),
        15: (182, 40),
        16: (30, 50),
        17: (29, None),
        21: (311, 7),
    }
    # aoi: [10, 20, 30, 40, 50] の中央値。12 を含めれば 35、11 を外せば 4 本で None になる
    assert result.author_summary == [("aoi", BASE, Decimal(30), 5), ("minato", BASE, None, 1)]


def test_derive_author_summary_own_median_leaves_out_ad_posts() -> None:
    """M-24 は著者自身のふだん。広告の記事は 30 日の値があっても入れない（助言 B-5）。"""
    posts = [
        _post(31, "aoi", date(2026, 1, 10)),
        _post(32, "aoi", date(2026, 2, 10)),
        _post(33, "aoi", date(2026, 3, 10)),
        _post(34, "aoi", date(2026, 4, 10)),
        _post(35, "aoi", date(2026, 5, 10)),
        _post(36, "aoi", date(2026, 6, 10), is_ad=True),
    ]
    stored = {
        (31, date(2026, 1, 10)): 10,
        (32, date(2026, 2, 10)): 20,
        (33, date(2026, 3, 10)): 30,
        (34, date(2026, 4, 10)): 40,
        (35, date(2026, 5, 10)): 50,
        (36, date(2026, 6, 10)): 9000,
    }
    result = _empty_run(posts, stored)
    # 広告の記事にも 30 日の値は付く（記事ごとの数字は出す）。
    assert {row[0]: row[5] for row in result.article_summary}[36] == 9000
    # 中央値は広告を除いた 5 本 [10, 20, 30, 40, 50] から。含めれば 35 で 6 本になる。
    assert result.author_summary == [("aoi", BASE, Decimal(30), 5)]


def test_derive_without_posts_still_writes_site_rows() -> None:
    result = _empty_run([], {(999, date(2026, 10, 30)): 500})
    assert len(result.period_rows) == 8
    assert len(result.site_period) == 8
    assert len(result.site_period_breakdown) == 22 * 8
    assert len(result.site_period_heatmap) == 168 * 8
    assert result.site_daily == []
    assert result.site_daily_channel == []
    assert result.site_daily_device == []
    assert result.article_daily == []
    assert result.article_period == []
    assert result.article_period_breakdown == []
    assert result.author_period_breakdown == []
    assert result.article_summary == []
    assert result.article_milestone == []
    assert result.author_summary == []
    assert result.sns_source_unmapped == []


# --- GA4 が行を返さない日（全指標が 0）---


def test_site_days_fills_interior_gaps_with_zero() -> None:
    site = {date(2025, 11, 3): (1, 1), date(2025, 11, 6): (8, 3)}
    assert _site_days_with_gaps_filled(site) == {
        date(2025, 11, 3): (1, 1),
        date(2025, 11, 4): (0, 0),
        date(2025, 11, 5): (0, 0),
        date(2025, 11, 6): (8, 3),
    }


def test_site_days_does_not_extend_past_the_last_returned_day() -> None:
    site = {date(2026, 11, 6): (10, 5)}
    assert _site_days_with_gaps_filled(site) == site


def test_site_days_empty_stays_empty() -> None:
    assert _site_days_with_gaps_filled({}) == {}


# --- 内部表の値と今回の取得の重ね合わせ ---


def test_merged_article_daily_prefers_refetched_days_and_drops_unknown_posts() -> None:
    posts = {1: _post(1, "aoi", date(2026, 10, 1))}
    raw = DailyRaw(start=date(2026, 11, 6), end=date(2026, 11, 7))
    raw.site[date(2026, 11, 6)] = (10, 5)
    raw.site[date(2026, 11, 7)] = (10, 5)
    raw.article[(1, date(2026, 11, 7))] = 4
    stored = {
        (1, date(2026, 11, 5)): 8,  # 取り直していない日 → 残る
        (1, date(2026, 11, 6)): 9,  # 取り直した日で今回は行がない → 消える
        (1, date(2026, 11, 7)): 99,  # 取り直した日 → 今回の値 4 だけ
        (2, date(2026, 11, 5)): 70,  # posts にない記事 → 落ちる
    }
    assert _merged_article_daily(stored, raw, posts) == {
        1: {date(2026, 11, 5): 8, date(2026, 11, 7): 4}
    }
