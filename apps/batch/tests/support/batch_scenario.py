"""I-B のフィクスチャ（07 §5、§10）。記事 6 本 + パスワード付き 1 本、著者 3 人。値はすべて架空。

期待値はテストの側に手計算で書く。ここには入力だけを置く。
基準日は 2026-11-03（火）。直近 7 日は 2026-10-28〜2026-11-03。
"""

from datetime import UTC, date, datetime, timedelta

from support.fake_ga4 import FakeRow
from support.fake_wp import FakeWp, wp_post, wp_user

BASE_DATE = date(2026, 11, 3)
# JST 17:00 の実行。基準日は前日
NOW = datetime(2026, 11, 4, 8, 0, tzinfo=UTC)
PROPERTY_ID = "123456789"
HOOK_URL = "https://api.vercel.com/v1/integrations/deploy/prj_fake/hook_fake"
MEASUREMENT_START = date(2025, 10, 8)
# 確定している月（月末 + 7 日 ≤ 基準日）
CONFIRMED_MONTHS = (
    *(f"m2025-{month:02d}" for month in (10, 11, 12)),
    *(f"m2026-{month:02d}" for month in range(1, 10)),
)

PARENT_CATEGORY = 1
CHILD_CATEGORY = 10
AD_CATEGORY = 188
AUTHOR_NAMES = {"author-a": "架空 一郎", "author-b": "架空 二子", "author-c": "架空 三太"}


def build_wp() -> FakeWp:
    return FakeWp(
        categories=[
            {"id": CHILD_CATEGORY, "name": "子カテゴリ", "parent": PARENT_CATEGORY},
            {"id": PARENT_CATEGORY, "name": "親カテゴリ", "parent": 0},
            {"id": AD_CATEGORY, "name": "広告の枠", "parent": 0},
        ],
        tags=[{"id": 20, "name": "タグ甲"}, {"id": 21, "name": "タグ乙"}],
        users={
            7: wp_user("author-a", AUTHOR_NAMES["author-a"]),
            8: wp_user("author-b", AUTHOR_NAMES["author-b"]),
            9: wp_user("author-c", AUTHOR_NAMES["author-c"]),
        },
        posts=[
            # UTC では 10-24 だが、JST では 10-25 の公開
            wp_post(101, date_gmt="2026-10-24T15:30:00", author=7, categories=[10], tags=[20]),
            wp_post(102, date_gmt="2026-09-20T03:00:00", author=7, categories=[10], tags=[20, 21]),
            wp_post(103, date_gmt="2026-08-01T03:00:00", author=8, categories=[1]),
            # 計測開始より前の公開
            wp_post(104, date_gmt="2025-09-01T03:00:00", author=8, categories=[1]),
            wp_post(105, date_gmt="2026-10-01T03:00:00", author=9, categories=[AD_CATEGORY]),
            # UTC では 11-01 だが、JST では 11-02 の公開
            wp_post(106, date_gmt="2026-11-01T16:00:00", author=7, categories=[10]),
            wp_post(107, date_gmt="2026-10-10T03:00:00", author=9, categories=[10], protected=True),
        ],
    )


def _ymd(day: date) -> str:
    return day.strftime("%Y%m%d")


def site_pageviews(day: date, bump: int = 0) -> int:
    """全体の日別の読まれた回数。日付から決まるので、どの日でも手計算できる。"""
    return 100 + day.day + bump


def site_sessions(day: date, bump: int = 0) -> int:
    return 50 + day.day + bump


def _site_daily_rows(start: date, end: date, bump: int) -> list[FakeRow]:
    days = [start + timedelta(days=offset) for offset in range((end - start).days + 1)]
    return [
        (
            {"date": _ymd(day)},
            {
                "screenPageViews": str(site_pageviews(day, bump)),
                "sessions": str(site_sessions(day, bump)),
            },
        )
        for day in days
    ]


def _daily(
    base: date, *, bump: int, social: int, first_day: date
) -> dict[str, dict[str, list[FakeRow]]]:
    channel = "sessionDefaultChannelGroup"
    day, before = _ymd(base), _ymd(base - timedelta(days=1))
    return {
        "G1": {"daily": _site_daily_rows(first_day, base + timedelta(days=1), bump)},
        "G2": {
            "daily": [
                ({"date": day, channel: "Organic Search"}, {"sessions": "30"}),
                ({"date": day, channel: "Organic Social"}, {"sessions": str(social)}),
                ({"date": day, channel: "Direct"}, {"sessions": "10"}),
                ({"date": day, channel: "Referral"}, {"sessions": "6"}),
                ({"date": day, channel: "Email"}, {"sessions": "7"}),
            ]
        },
        "G3": {
            "daily": [
                (
                    {"date": day, "deviceCategory": "mobile"},
                    {"screenPageViews": "80", "sessions": "40"},
                ),
                (
                    {"date": day, "deviceCategory": "desktop"},
                    {"screenPageViews": "30", "sessions": "12"},
                ),
                (
                    {"date": day, "deviceCategory": "tablet"},
                    {"screenPageViews": "3", "sessions": "2"},
                ),
                # 3 区分に入らない値は内訳に数えない
                (
                    {"date": day, "deviceCategory": "smart tv"},
                    {"screenPageViews": "1", "sessions": "1"},
                ),
            ]
        },
        "G4": {
            "daily": [
                ({"date": day, "pagePath": "/101/"}, {"screenPageViews": "40"}),
                # 末尾のスラッシュがないパスは同じ記事に合算する
                ({"date": day, "pagePath": "/101"}, {"screenPageViews": "2"}),
                ({"date": day, "pagePath": "/102/"}, {"screenPageViews": "10"}),
                ({"date": day, "pagePath": "/103/"}, {"screenPageViews": "3"}),
                ({"date": day, "pagePath": "/105/"}, {"screenPageViews": "8"}),
                ({"date": day, "pagePath": "/106/"}, {"screenPageViews": "6"}),
                # 知らない記事と記事以外は捨てる
                ({"date": day, "pagePath": "/999/"}, {"screenPageViews": "5"}),
                ({"date": day, "pagePath": "/"}, {"screenPageViews": "30"}),
                ({"date": before, "pagePath": "/101/"}, {"screenPageViews": "20"}),
                ({"date": before, "pagePath": "/102/"}, {"screenPageViews": "7"}),
                ({"date": before, "pagePath": "/106/"}, {"screenPageViews": "4"}),
                # 公開日（11-02）より前の日の値。日別には残るが、累積と合計には入れない
                ({"date": "20261101", "pagePath": "/106/"}, {"screenPageViews": "9"}),
                ({"date": "20261028", "pagePath": "/101/"}, {"screenPageViews": "15"}),
            ]
        },
    }


def _last7() -> dict[str, list[FakeRow]]:
    channel = "sessionDefaultChannelGroup"
    return {
        "G5": [({}, {"activeUsers": "300", "userEngagementDuration": "12345.6"})],
        "G6": [
            ({"newVsReturning": "new"}, {"activeUsers": "200"}),
            ({"newVsReturning": "returning"}, {"activeUsers": "97"}),
            ({"newVsReturning": "(not set)"}, {"activeUsers": "3"}),
        ],
        "G7": [
            ({"sessionSource": "l.instagram.com"}, {"sessions": "12"}),
            ({"sessionSource": "t.co"}, {"sessions": "6"}),
            # 規則にない参照元は other に数え、確認用の表に残す
            ({"sessionSource": "mystery.example"}, {"sessions": "4"}),
        ],
        "G8": [
            ({"dayOfWeek": "2", "hour": "21"}, {"screenPageViews": "50"}),
            ({"dayOfWeek": "0", "hour": "9"}, {"screenPageViews": "3"}),
        ],
        "G9": [
            ({"country": "Japan", "region": "Kanagawa", "city": "Kawasaki"}, {"sessions": "40"}),
            ({"country": "Japan", "region": "Tokyo", "city": "Setagaya"}, {"sessions": "9"}),
            ({"country": "Japan", "region": "(not set)", "city": "(not set)"}, {"sessions": "2"}),
            (
                {"country": "United States", "region": "California", "city": "(not set)"},
                {"sessions": "1"},
            ),
        ],
        "G10": [
            ({"landingPage": "/101/"}, {"sessions": "25"}),
            ({"landingPage": "/102/"}, {"sessions": "4"}),
            ({"landingPage": "/106/"}, {"sessions": "15"}),
            ({"landingPage": "/category/local/"}, {"sessions": "50"}),
        ],
        "G11": [
            ({"pagePath": "/101/"}, {"userEngagementDuration": "900"}),
            ({"pagePath": "/102/"}, {"userEngagementDuration": "100"}),
        ],
        "G12": [
            ({"pagePath": "/101/"}, {"eventCount": "18"}),
            ({"pagePath": "/102/"}, {"eventCount": "3"}),
        ],
        "G13": [
            ({"landingPage": "/101/", channel: "Organic Search"}, {"sessions": "12"}),
            ({"landingPage": "/101/", channel: "Organic Social"}, {"sessions": "8"}),
            ({"landingPage": "/101/", channel: "Direct"}, {"sessions": "5"}),
            # 著者 author-a の記事のうち、この 1 本だけが social で伏さる（階層差分）
            ({"landingPage": "/102/", channel: "Organic Social"}, {"sessions": "4"}),
            ({"landingPage": "/106/", channel: "Organic Social"}, {"sessions": "9"}),
            ({"landingPage": "/106/", channel: "Direct"}, {"sessions": "6"}),
        ],
        "G14": [({"landingPage": "/101/", "sessionSource": "l.instagram.com"}, {"sessions": "8"})],
        "G15": [
            ({"landingPage": "/101/", "deviceCategory": "mobile"}, {"sessions": "20"}),
            ({"landingPage": "/101/", "deviceCategory": "desktop"}, {"sessions": "5"}),
            ({"landingPage": "/102/", "deviceCategory": "mobile"}, {"sessions": "4"}),
        ],
        "G19": [
            ({channel: "Organic Search"}, {"sessions": "150"}),
            ({channel: "Organic Social"}, {"sessions": "22"}),
            ({channel: "Direct"}, {"sessions": "60"}),
            ({channel: "Referral"}, {"sessions": "8"}),
            ({channel: "Unassigned"}, {"sessions": "5"}),
        ],
        "G20": [
            ({"deviceCategory": "mobile"}, {"screenPageViews": "500", "sessions": "250"}),
            ({"deviceCategory": "desktop"}, {"screenPageViews": "200", "sessions": "80"}),
            ({"deviceCategory": "tablet"}, {"screenPageViews": "20", "sessions": "9"}),
        ],
    }


def _month_referrers(period_id: str) -> list[FakeRow]:
    if period_id != "m2026-09":
        return [({"sessionSource": "portal.example"}, {"sessions": "9"})]
    return [
        ({"sessionSource": "news.example"}, {"sessions": "30"}),
        ({"sessionSource": "blog.example"}, {"sessions": "12"}),
        # 大文字と小文字の違いは同じドメインに合算する
        ({"sessionSource": "Blog.Example"}, {"sessions": "3"}),
        # しきい値未満の行と、値のない参照元は格納しない
        ({"sessionSource": "tiny.example"}, {"sessions": "4"}),
        ({"sessionSource": "(direct)"}, {"sessions": "9"}),
    ]


def _month_cities(period_id: str) -> list[FakeRow]:
    kawasaki = {"country": "Japan", "region": "Kanagawa", "city": "Kawasaki"}
    if period_id != "m2026-09":
        return [(kawasaki, {"sessions": "50"})]
    return [
        (kawasaki, {"sessions": "100"}),
        ({"country": "Japan", "region": "Tokyo", "city": "Setagaya"}, {"sessions": "20"}),
        ({"country": "Japan", "region": "Kanagawa", "city": "Yokohama"}, {"sessions": "4"}),
    ]


def ga4_responses(
    base: date = BASE_DATE,
    *,
    bump: int = 0,
    social: int = 4,
    first_day: date = MEASUREMENT_START,
) -> dict[str, dict[str, list[FakeRow]]]:
    """偽の GA4 に渡す応答。bump と social は 2 回目の実行で値を変えるために使う（I-B-02）。

    日別は first_day から基準日の翌日までの行を持つ。返すのは偽の GA4 が request の期間で絞った分。
    """
    responses = _daily(base, bump=bump, social=social, first_day=first_day)
    for query_id, rows in _last7().items():
        responses[query_id] = {"last7": rows}
    responses["G5"]["last28"] = [({}, {"activeUsers": "900", "userEngagementDuration": "40000"})]
    for period_id in CONFIRMED_MONTHS:
        responses["G9"][period_id] = _month_cities(period_id)
    responses["G16"] = {period_id: _month_referrers(period_id) for period_id in CONFIRMED_MONTHS}
    responses["G17"] = {
        "article": [
            ({"landingPage": "/102/", "sessionSource": "news.example"}, {"sessions": "7"}),
            ({"landingPage": "/102/", "sessionSource": "x.example"}, {"sessions": "2"}),
            ({"landingPage": "/103/", "sessionSource": "old.example"}, {"sessions": "6"}),
        ]
    }
    return responses
