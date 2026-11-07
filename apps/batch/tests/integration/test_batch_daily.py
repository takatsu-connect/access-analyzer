"""I-B-01〜I-B-09: daily / backfill / publish_only を端から端まで（07 §5）。

GA4 は偽クライアント、WP と Deploy Hook は respx。書き込み先はローカルの Supabase で、
batch_writer で接続する。期待値は tests/support/batch_scenario.py の入力から手計算した。
"""

import json
from datetime import date, timedelta
from typing import Any

import google.api_core.exceptions as google_api
import pytest

from integration.conftest import Harness, Query
from support import batch_scenario as scenario
from support.fake_ga4 import FakeGa4
from support.fake_wp import wp_post
from takatsu_batch import cli, pipeline, wp_fetch
from takatsu_batch.config import WP_REQUEST_INTERVAL_MS
from takatsu_batch.models import RunCounts

pytestmark = pytest.mark.db

D = scenario.BASE_DATE
LOG_KEYS = {"step", "event", "count", "n", "duration_ms", "kind"}


def _day(offset: int) -> date:
    return D + timedelta(days=offset)


def _log_lines(output: str) -> list[dict[str, Any]]:
    return [json.loads(line) for line in output.splitlines()]


def _next_day(harness: Harness, *, bump: int = 0, social: int = 4) -> None:
    """翌日の実行に進める。GA4 の値は bump と social で変えられる。"""
    harness.now = scenario.NOW + timedelta(days=1)
    harness.ga4 = FakeGa4(scenario.ga4_responses(bump=bump, social=social))


def _site_pageviews(query: Query) -> dict[date, int]:
    return {row[0]: row[1] for row in query("select day, pageviews from internal.site_daily")}


def test_i_b_01_wp_tables(harness: Harness, query: Query, monkeypatch: pytest.MonkeyPatch) -> None:
    # 記事の一覧が 3 ページ以上になるようにする
    monkeypatch.setattr(wp_fetch, "WP_PER_PAGE", 2)
    assert harness.run() == 0
    assert len(harness.wp.post_requests(id_list=True)) == 4
    assert len(harness.wp.post_requests(id_list=False)) == 4

    # パスワード付きの 107 は取り込まない。公開日は JST の暦日
    assert query(
        """
        select post_id, author_slug, published_on, is_ad, first_seen_on
        from internal.wp_post order by post_id
        """
    ) == [
        (101, "author-a", date(2026, 10, 25), False, D),
        (102, "author-a", date(2026, 9, 20), False, D),
        (103, "author-b", date(2026, 8, 1), False, D),
        (104, "author-b", date(2025, 9, 1), False, D),
        (105, "author-c", date(2026, 10, 1), True, D),
        (106, "author-a", date(2026, 11, 2), False, D),
    ]
    assert query(
        "select author_slug, display_name, author_url from internal.wp_author order by 1"
    ) == [
        (slug, name, f"https://takatsu-connect.com/author/{slug}/")
        for slug, name in sorted(scenario.AUTHOR_NAMES.items())
    ]
    assert query(
        "select category_id, name, parent_id, path from internal.wp_category order by 1"
    ) == [
        (1, "親カテゴリ", None, "親カテゴリ"),
        (10, "子カテゴリ", 1, "親カテゴリ > 子カテゴリ"),
        (188, "広告の枠", None, "広告の枠"),
    ]
    assert query("select post_id, category_id from internal.wp_post_category order by 1, 2") == [
        (101, 10),
        (102, 10),
        (103, 1),
        (104, 1),
        (105, 188),
        (106, 10),
    ]
    assert query("select post_id, tag_id from internal.wp_post_tag order by 1, 2") == [
        (101, 20),
        (102, 20),
        (102, 21),
    ]


def test_i_b_01_daily_tables(harness: Harness, query: Query) -> None:
    assert harness.run() == 0

    days = [_day(offset) for offset in range(-6, 1)]
    assert query("select day, pageviews, sessions from internal.site_daily order by day") == [
        (day, scenario.site_pageviews(day), scenario.site_sessions(day)) for day in days
    ]
    # 5 区分のうち social だけが 4 → 伏せ。T 以上で最小の referral が二次伏せ
    channel = query(
        "select channel, sessions, sessions_mask from internal.site_daily_channel where day = %s",
        (D,),
    )
    assert {row[0]: row[1:] for row in channel} == {
        "search": (30, None),
        "social": (None, "threshold"),
        "direct": (10, None),
        "referral": (None, "secondary"),
        "other": (7, None),
    }
    assert query("select count(*) from internal.site_daily_channel") == [(35,)]
    device = query(
        """
        select device, pageviews, pageviews_mask, sessions, sessions_mask
        from internal.site_daily_device where day = %s
        """,
        (D,),
    )
    assert {row[0]: row[1:] for row in device} == {
        "mobile": (80, None, 40, None),
        "desktop": (None, "secondary", None, "secondary"),
        "tablet": (None, "threshold", None, "threshold"),
    }
    # /101 と /101/ は合算。知らない記事と記事以外は入らない
    assert query("select post_id, day, pageviews from internal.article_daily order by 1, 2") == [
        (101, _day(-6), 15),
        (101, _day(-1), 20),
        (101, D, 42),
        (102, _day(-1), 7),
        (102, D, 10),
        (103, D, 3),
        (105, D, 8),
        (106, _day(-2), 9),
        (106, _day(-1), 4),
        (106, D, 6),
    ]


def test_i_b_01_period_tables(harness: Harness, query: Query) -> None:
    assert harness.run() == 0

    periods = {
        row[0]: row[1:]
        for row in query(
            "select period_id, kind, start_date, end_date, is_confirmed from internal.period"
        )
    }
    assert len(periods) == 20
    assert periods["last7"] == ("window", _day(-6), D, False)
    assert periods["prev7"] == ("window", _day(-13), _day(-7), False)
    assert periods["last28"] == ("window", _day(-27), D, False)
    assert periods["m2026-11"] == ("month", date(2026, 11, 1), D, False)
    assert periods["m2026-10"] == ("month", date(2026, 10, 1), date(2026, 10, 31), False)
    assert periods["m2025-10"] == ("month", date(2025, 10, 1), date(2025, 10, 31), True)
    assert {key for key, value in periods.items() if value[3]} == set(scenario.CONFIRMED_MONTHS)

    site_period = {
        row[0]: row[1:]
        for row in query(
            """
            select period_id, engagement_seconds, active_users, active_users_mask
            from internal.site_period where period_id in ('last7', 'last28', 'prev7')
            """
        )
    }
    assert site_period == {
        "last7": (12345, 300, None),
        "last28": (40000, 900, None),
        "prev7": (0, 0, None),
    }

    breakdown = {
        (row[0], row[1]): row[2:]
        for row in query(
            """
            select axis, bucket, value, value_mask
            from internal.site_period_breakdown where period_id = 'last7'
            """
        )
    }
    assert breakdown == {
        ("sns", "instagram"): (12, None),
        ("sns", "facebook"): (0, None),
        ("sns", "x"): (None, "secondary"),
        ("sns", "line"): (0, None),
        ("sns", "other"): (None, "threshold"),
        ("new_returning", "new"): (200, None),
        ("new_returning", "returning"): (None, "secondary"),
        ("new_returning", "unknown"): (None, "threshold"),
        ("local", "kawasaki"): (40, None),
        ("local", "japan_other"): (None, "secondary"),
        ("local", "unknown"): (None, "threshold"),
        ("channel", "search"): (150, None),
        ("channel", "social"): (22, None),
        ("channel", "direct"): (60, None),
        ("channel", "referral"): (8, None),
        ("channel", "other"): (5, None),
        ("device_pv", "mobile"): (500, None),
        ("device_pv", "desktop"): (200, None),
        ("device_pv", "tablet"): (20, None),
        ("device_sessions", "mobile"): (250, None),
        ("device_sessions", "desktop"): (80, None),
        ("device_sessions", "tablet"): (9, None),
    }

    # 168 セルを 1 つの区分として扱う。伏せが 1 つなので、T 以上で最小のセルも伏せる
    assert query("select count(*) from internal.site_period_heatmap where period_id = 'last7'") == [
        (168,)
    ]
    assert query(
        """
        select dow, hour, pageviews, pageviews_mask from internal.site_period_heatmap
        where period_id = 'last7' and pageviews is distinct from 0 order by 1, 2
        """
    ) == [(0, 9, None, "threshold"), (2, 21, None, "secondary")]


def test_i_b_01_article_and_author_tables(harness: Harness, query: Query) -> None:
    assert harness.run() == 0

    article_period = {
        row[0]: row[1:]
        for row in query(
            """
            select post_id, pageviews, landing_sessions, landing_sessions_mask,
                   scroll_count, scroll_count_mask, engagement_seconds, engagement_seconds_mask
            from internal.article_period where period_id = 'last7'
            """
        )
    }
    assert article_period == {
        101: (77, 25, None, 18, None, 900, None),
        102: (17, None, "threshold", None, "threshold", 100, None),
        103: (3, 0, None, 0, None, 0, None),
        104: (0, 0, None, 0, None, 0, None),
        105: (8, 0, None, 0, None, 0, None),
        # 期間の合計は日別の合計なので、公開日より前の日（9）も入る
        106: (19, 15, None, 0, None, 0, None),
    }
    # 全公開記事 × 全期間の行がある
    assert query("select count(*) from internal.article_period") == [(120,)]
    assert query(
        "select pageviews from internal.article_period where post_id = 101 and period_id = %s",
        ("m2026-11",),
    ) == [(62,)]

    article_cells = {
        row[:3]: row[3:]
        for row in query(
            """
            select post_id, axis, bucket, sessions, sessions_mask
            from internal.article_period_breakdown where period_id = 'last7'
            """
        )
    }
    assert len(article_cells) == 6 * (5 + 5 + 3)
    assert article_cells[(101, "channel", "search")] == (12, None)
    assert article_cells[(101, "channel", "social")] == (8, None)
    assert article_cells[(101, "channel", "direct")] == (5, None)
    # 伏せが 1 つで、ほかが 0 なので二次伏せの候補がない
    assert article_cells[(102, "channel", "social")] == (None, "threshold")
    assert article_cells[(102, "channel", "search")] == (0, None)
    assert article_cells[(101, "sns", "instagram")] == (8, None)
    assert article_cells[(101, "device", "mobile")] == (20, None)
    assert article_cells[(101, "device", "desktop")] == (5, None)
    assert article_cells[(102, "device", "mobile")] == (None, "threshold")

    author_cells = {
        row[:3]: row[3:]
        for row in query(
            """
            select author_slug, axis, bucket, sessions, sessions_mask
            from internal.author_period_breakdown where period_id = 'last7'
            """
        )
    }
    # 著者 × デバイスは格納しない
    assert {key[1] for key in author_cells} == {"channel", "sns"}
    # 合算は search 12、social 21、direct 11。記事 102 だけが social で伏さるので著者の social も
    # 伏せ（階層差分）、伏せが 1 つになったので T 以上で最小の direct も伏せる
    assert {
        key[2]: value for key, value in author_cells.items() if key[:2] == ("author-a", "channel")
    } == {
        "search": (12, None),
        "social": (None, "secondary"),
        "direct": (None, "secondary"),
        "referral": (0, None),
        "other": (0, None),
    }
    assert author_cells[("author-a", "sns", "instagram")] == (8, None)
    assert author_cells[("author-b", "channel", "search")] == (0, None)


def test_i_b_01_confirmed_and_derived_tables(harness: Harness, query: Query) -> None:
    assert harness.run() == 0

    # T 未満と値のない参照元は格納しない。大文字と小文字は合算する
    assert query(
        """
        select rank, source_domain, sessions from internal.site_month_referrer
        where period_id = 'm2026-09' order by rank
        """
    ) == [(1, "news.example", 30), (2, "blog.example", 15)]
    assert query("select count(distinct period_id) from internal.site_month_referrer") == [(12,)]
    assert query(
        """
        select rank, country, region, city, sessions from internal.site_month_city
        where period_id = 'm2026-09' order by rank
        """
    ) == [(1, "Japan", "Kanagawa", "Kawasaki", 100), (2, "Japan", "Tokyo", "Setagaya", 20)]
    # 公開日 + 36 日 ≤ 基準日 の記事（102、103、104）だけを計算する
    assert query(
        """
        select post_id, rank, source_domain, sessions, computed_on
        from internal.article_referrer_30d order by 1, 2
        """
    ) == [(102, 1, "news.example", 7, D), (103, 1, "old.example", 6, D)]

    assert query(
        """
        select post_id, base_date, age_days, freshness, pv_7d, pv_30d, pv_total,
               is_recent_hot, is_revival, is_evergreen_365, referrer_30d_computed_on
        from internal.article_summary order by post_id
        """
    ) == [
        (101, D, 10, "new", 15, None, 77, False, False, False, None),
        (102, D, 45, "mid", 0, 0, 17, False, False, False, D),
        (103, D, 95, "long", 0, 0, 3, False, False, False, D),
        # 計測開始より前の公開は 7 日と 30 日の値を持たない
        (104, D, 429, "long", None, None, 0, False, False, False, D),
        (105, D, 34, "mid", 0, 0, 8, False, False, False, None),
        # 公開日より前の日の 9 は合計に入れない
        (106, D, 2, "new", None, None, 10, False, False, False, None),
    ]
    assert query("select count(*) from internal.article_milestone") == [(0,)]
    assert query(
        """
        select author_slug, base_date, own_median_30d, eligible_count
        from internal.author_summary order by 1
        """
        # author-c の記事 105 は広告なので、M-24 の本数に入れない（助言 B-5）。
    ) == [("author-a", D, None, 1), ("author-b", D, None, 1), ("author-c", D, None, 0)]
    assert query(
        """
        select source, first_seen_on, last_seen_on, last_sessions
        from internal.sns_source_unmapped
        """
    ) == [("mystery.example", D, D, 4)]


def test_i_b_01_run_record_and_public_views(harness: Harness, query: Query) -> None:
    assert harness.run() == 0

    rows = query(
        """
        select status, mode, base_date, failed_step, error_kind, mask_threshold,
               finished_at is not null, github_run_id, counts
        from internal.batch_run
        """
    )
    assert len(rows) == 1
    assert rows[0][:8] == ("success", "daily", D, None, None, 5, True, None)
    counts = rows[0][8]
    assert counts.keys() == RunCounts.model_fields.keys()
    assert counts["wp_requests"] == len(harness.wp.requests)
    # 日別 4 + 20 期間（4 つずつ 5 集合）× 13 種 + 確定月の参照元 12 + 記事の参照元 2
    # （102 と 103。計測開始より前に公開した 104 は問い合わせない）
    assert counts["ga4_requests"] == len(harness.ga4.requests) == 83
    assert harness.ga4.query_ids.count("G17") == 2
    assert counts["posts_upserted"] == 6
    assert counts["posts_deleted"] == 0
    assert counts["rows_written"] > 0

    # 公開ビューが読める状態になっている（BI のビルドが読む範囲）
    assert query("select base_date, mask_threshold, last_status from public.pub_meta") == [
        (D, 5, "success")
    ]
    assert query("select count(*) from public.pub_post") == [(6,)]
    # 累積は公開日が 1 日目。公開前の日は入らず、計測開始より前に公開した記事は行がない
    assert query(
        "select n, cumulative_pv from public.pub_article_cumulative where post_id = 106 order by n"
    ) == [(1, 4), (2, 10)]
    assert query(
        """
        select n, cumulative_pv from public.pub_article_cumulative
        where post_id = 101 and n in (3, 4, 9, 10) order by n
        """
    ) == [(3, 0), (4, 15), (9, 35), (10, 77)]
    assert query("select count(*) from public.pub_article_cumulative where post_id = 104") == [(0,)]


def test_i_b_02_refetch_overwrites_last_7_days(harness: Harness, query: Query) -> None:
    assert harness.run() == 0
    before = _site_pageviews(query)
    wp_requests_before = len(harness.wp.requests)

    # 2 回目: GA4 の値がすべての日で 1000 増え、基準日の social が 4 → 6 になる
    _next_day(harness, bump=1000, social=6)
    assert harness.run() == 0

    after = _site_pageviews(query)
    # 8 日以上前（基準日 − 6 日）は取り直さない
    assert after[_day(-6)] == before[_day(-6)]
    for offset in range(-5, 1):
        assert after[_day(offset)] == before[_day(offset)] + 1000
    assert after[_day(1)] == scenario.site_pageviews(_day(1), 1000)
    assert len(after) == 8
    # 伏せ → 表示。二次伏せも外れる
    channel = query(
        "select channel, sessions, sessions_mask from internal.site_daily_channel where day = %s",
        (D,),
    )
    assert {row[0]: row[1:] for row in channel}["social"] == (6, None)
    assert {row[0]: row[1:] for row in channel}["referral"] == (6, None)
    # 取り直さない日の記事の値は残る
    assert query(
        "select pageviews from internal.article_daily where post_id = 101 and day = %s",
        (_day(-6),),
    ) == [(15,)]
    assert query("select status from internal.batch_run order by run_id") == [
        ("success",),
        ("success",),
    ]

    # I-B-06: 2 回目は差分だけを取る。記事の本体を全件取得しない。
    # 公開中なのに前回の状態にない 107（パスワード付き）だけは、ID を指定して取って捨てる
    second = harness.wp.requests[wp_requests_before:]
    assert len(second) == 5
    detail_requests = [
        request
        for request in second
        if request.url.path.endswith("/posts") and request.url.params["_fields"] != "id"
    ]
    assert [
        (request.url.params.get("modified_after"), request.url.params.get("include"))
        for request in detail_requests
    ] == [("2026-11-03T08:00:00Z", None), (None, "107")]
    assert query("select count(*) from internal.wp_post where post_id = 107") == [(0,)]

    # I-B-07: 通常日は日別 4 + 8 期間（2 集合）× 13 種。見込み（約 30）の 1.5 倍以内
    assert len(harness.ga4.requests) == 30
    counts = query("select counts from internal.batch_run order by run_id desc limit 1")[0][0]
    assert counts["ga4_requests"] == 30
    assert counts["ga4_tokens"] == 300
    assert counts["ga4_tokens_remaining_day"] == 199_990
    # 1 時間の残量は、厳しいほう（プロジェクト × プロパティ）を残す
    assert counts["ga4_tokens_remaining_hour"] == 13_990


def test_i_b_03_deleted_and_protected_posts_disappear(harness: Harness, query: Query) -> None:
    assert harness.run() == 0

    # 103 は一覧から消え、102 はパスワード付きになる
    harness.wp.posts = [post for post in harness.wp.posts if post["id"] != 103]
    protected = next(post for post in harness.wp.posts if post["id"] == 102)
    protected["content"] = {"protected": True}
    protected["modified_gmt"] = "2026-11-04T01:00:00"
    _next_day(harness)
    assert harness.run() == 0

    assert query("select post_id from internal.wp_post order by 1") == [
        (101,),
        (104,),
        (105,),
        (106,),
    ]
    for table in (
        "wp_post_category",
        "wp_post_tag",
        "article_daily",
        "article_period",
        "article_period_breakdown",
        "article_referrer_30d",
        "article_summary",
    ):
        remaining = query(
            f"select count(*) from internal.{table} where post_id in (102, 103)"  # noqa: S608
        )
        assert remaining == [(0,)], table
    assert query("select post_id from public.pub_post order by 1") == [
        (101,),
        (104,),
        (105,),
        (106,),
    ]
    # 残る記事がある著者は消えない
    assert query("select count(*) from internal.wp_author") == [(3,)]
    counts = query("select counts from internal.batch_run order by run_id desc limit 1")[0][0]
    assert counts["posts_deleted"] == 2


def test_stale_rows_are_removed_on_refetch(harness: Harness, query: Query) -> None:
    """取り直した範囲で、今回のキー集合にない行を消す（03 §7）。truncate は使わない。"""
    assert harness.run() == 0
    assert query(
        "select pageviews from internal.article_daily where post_id = 102 and day = %s",
        (_day(-1),),
    ) == [(7,)]

    # 2 回目: 101 のカテゴリが 10 → 1 に変わり、GA4 は 102 の前日の行を返さなくなる
    changed = next(post for post in harness.wp.posts if post["id"] == 101)
    changed["categories"] = [scenario.PARENT_CATEGORY]
    changed["modified_gmt"] = "2026-11-04T01:00:00"
    _next_day(harness)
    responses = scenario.ga4_responses()
    responses["G4"]["daily"] = [
        row
        for row in responses["G4"]["daily"]
        if (row[0]["pagePath"], row[0]["date"]) != ("/102/", "20261102")
    ]
    harness.ga4 = FakeGa4(responses)
    assert harness.run() == 0

    assert query(
        "select count(*) from internal.article_daily where post_id = 102 and day = %s",
        (_day(-1),),
    ) == [(0,)]
    # 取り直さない日（基準日 − 6 日）の行は、GA4 が返さなくても消さない
    assert query(
        "select pageviews from internal.article_daily where post_id = 101 and day = %s",
        (_day(-6),),
    ) == [(15,)]
    assert query("select category_id from internal.wp_post_category where post_id = 101") == [
        (scenario.PARENT_CATEGORY,)
    ]
    # 記事は消えていない
    counts = query("select counts from internal.batch_run order by run_id desc limit 1")[0][0]
    assert counts["posts_deleted"] == 0
    assert counts["posts_upserted"] == 1


@pytest.mark.parametrize(
    ("error", "kind", "wait"),
    [
        (google_api.ResourceExhausted, "quota", 60.0),
        (google_api.InternalServerError, "network", 2.0),
    ],
)
def test_i_b_04_ga4_failure_keeps_previous_data(
    harness: Harness,
    query: Query,
    capsys: pytest.CaptureFixture[str],
    error: type[Exception],
    kind: str,
    wait: float,
) -> None:
    assert harness.run() == 0
    capsys.readouterr()

    _next_day(harness)
    message = f"properties/{scenario.PROPERTY_ID} failed"
    harness.ga4.side_effects["G1"] = [error(message), error(message)]
    assert harness.run() == 1

    # 待ってから 1 回だけ再試行している
    assert wait in harness.clock.sleeps
    assert harness.ga4.query_ids == ["G1", "G1"]
    assert query(
        """
        select status, failed_step, error_kind, finished_at is not null
        from internal.batch_run order by run_id
        """
    ) == [("success", None, None, True), ("failed", "ga4_daily", kind, True)]
    # ログは工程と種別だけ
    output = capsys.readouterr().out
    assert _log_lines(output)[-1] == {"step": "ga4_daily", "kind": kind}
    assert "properties/" not in output
    assert scenario.PROPERTY_ID not in output
    # 前回の成功時のデータが残り、公開（再ビルド）は起きない
    assert query("select count(*), max(day) from internal.site_daily") == [(7, D)]
    assert query("select base_date, last_status from public.pub_meta") == [(D, "failed")]
    assert harness.hook.call_count == 1
    # 失敗した実行にも、そこまでのリクエスト数と割当の残量を残す
    counts = query("select counts from internal.batch_run order by run_id desc limit 1")[0][0]
    assert counts["ga4_requests"] == 2
    assert counts["wp_requests"] == 5
    assert counts["duration_ms"] > 0
    assert counts["rows_written"] == 0


def test_daily_runs_again_when_earlier_success_started_before_data_was_ready(
    harness: Harness, query: Query, capsys: pytest.CaptureFixture[str]
) -> None:
    """GA4 の前日ぶんが揃う前（JST 15:30 より前）の手動実行で、定時の実行を止めない（03 §3）。"""
    harness.now = scenario.NOW - timedelta(hours=3)  # JST 14:00
    assert harness.run() == 0
    assert query("select count(*) from internal.batch_run where status = 'success'") == [(1,)]

    # 定時（JST 17:00）の実行は、揃ってからの成功がまだないので、取り直す
    harness.now = scenario.NOW
    harness.ga4 = FakeGa4(scenario.ga4_responses(bump=1000))
    capsys.readouterr()
    assert harness.run() == 0
    assert {"step": "preflight", "event": "skip"} not in _log_lines(capsys.readouterr().out)
    assert query("select count(*) from internal.batch_run where status = 'success'") == [(2,)]
    assert query("select pageviews from internal.site_daily where day = %s", (D,)) == [
        (scenario.site_pageviews(D, 1000),)
    ]

    # 保険の 2 本目（JST 18:00）は、揃ってからの成功があるので何もしない
    harness.now = scenario.NOW + timedelta(hours=1)
    assert harness.run() == 0
    assert {"step": "preflight", "event": "skip"} in _log_lines(capsys.readouterr().out)
    assert query("select count(*) from internal.batch_run") == [(2,)]


def test_posts_published_after_base_date_come_in_on_the_next_run(
    harness: Harness, query: Query
) -> None:
    """実行日（基準日の翌日）に公開された記事は、次の実行で入る。予約投稿は ID の指定で補う。"""
    harness.wp.posts += [
        # JST の 11-04 に公開（基準日 11-03 より後）
        wp_post(108, date_gmt="2026-11-03T16:00:00", author=8, categories=[10]),
        # 予約投稿: 公開は同じ日だが、最後に編集したのは 2 週間前
        wp_post(
            109,
            date_gmt="2026-11-03T16:30:00",
            modified_gmt="2026-10-20T00:00:00",
            author=7,
            categories=[10],
        ),
    ]
    assert harness.run() == 0
    assert query("select count(*) from internal.wp_post where post_id in (108, 109)") == [(0,)]
    assert query("select count(*) from public.pub_post") == [(6,)]

    wp_requests_before = len(harness.wp.requests)
    _next_day(harness)
    assert harness.run() == 0
    assert query(
        """
        select p.post_id, p.published_on, p.first_seen_on, s.age_days
        from internal.wp_post p join internal.article_summary s using (post_id)
        where p.post_id in (108, 109) order by 1
        """
    ) == [(108, _day(1), _day(1), 1), (109, _day(1), _day(1), 1)]
    # 108 は差分で入る。109 は差分に出ないので ID の指定で取る
    # （パスワード付きの 107 も一緒に取って捨てる）
    includes = [
        request.url.params["include"]
        for request in harness.wp.requests[wp_requests_before:]
        if "include" in request.url.params
    ]
    assert includes == ["107,109"]
    assert query("select count(*) from internal.wp_post where post_id = 107") == [(0,)]


def test_i_b_05_log_discipline(
    harness: Harness, query: Query, capsys: pytest.CaptureFixture[str]
) -> None:
    assert harness.run() == 0
    captured = capsys.readouterr()
    assert captured.err == ""
    lines = _log_lines(captured.out)
    # 工程、件数、所要時間だけ。値は固定の語と数値
    for line in lines:
        assert line.keys() <= LOG_KEYS
        assert all(isinstance(value, str | int) for value in line.values())
    assert {"step": "publish", "count": "ga4_requests", "n": 83} in lines
    # backfill をせずに daily から始めたので、直近 7 日より前に公開した 5 本は日別の値が欠ける
    assert {"step": "wp_fetch", "count": "posts_late_seen", "n": 5} in lines
    assert {"step": "ga4_period", "count": "ga4_unknown_device_rows", "n": 1} in lines
    assert {"step": "ga4_daily", "count": "ga4_missing_days", "n": 0} in lines
    forbidden = [
        "Bearer",
        "eyJ",
        "postgresql://",
        "pooler",
        "batch_writer",
        "https://",
        scenario.PROPERTY_ID,
        "架空",
        "カテゴリ",
        "author-",
        ".example",
        "Kawasaki",
        "/101/",
    ]
    for word in forbidden:
        assert word not in captured.out, word


def test_i_b_06_wp_requests(harness: Harness, query: Query) -> None:
    assert harness.run() == 0
    requests = harness.wp.requests
    assert requests
    for request in requests:
        assert str(request.url).startswith("https://takatsu-connect.com/wp-json/wp/v2/")
        assert request.method == "GET"
    paths = {request.url.path.removeprefix("/wp-json/wp/v2") for request in requests}
    assert paths == {"/categories", "/tags", "/posts", "/users/7", "/users/8", "/users/9"}
    # リクエストの間隔は設定値以上（偽の時計は sleep でだけ進む）
    times = harness.wp.request_times
    gaps = [later - earlier for earlier, later in zip(times, times[1:], strict=False)]
    assert min(gaps) >= WP_REQUEST_INTERVAL_MS / 1000


def test_i_b_08_backfill(
    harness: Harness, query: Query, capsys: pytest.CaptureFixture[str]
) -> None:
    # from と to を省くと、計測開始日から基準日（実行時刻の前日）まで
    assert harness.run(pipeline.RunRequest("backfill")) == 0
    total_days = (D - scenario.MEASUREMENT_START).days + 1
    assert total_days == 392
    assert query("select count(*), min(day), max(day) from internal.site_daily") == [
        (total_days, scenario.MEASUREMENT_START, D)
    ]
    # 90 日ずつに分けて取る
    assert harness.ga4.query_ids.count("G1") == 5
    first = harness.ga4.requests[0].date_ranges[0]
    assert (first.start_date, first.end_date) == ("2025-10-08", "2026-01-05")
    # 記事は全件を取る（差分の条件を付けない）
    for request in harness.wp.post_requests(id_list=False):
        assert "modified_after" not in request.url.params
    assert query("select mode, status from internal.batch_run") == [("backfill", "success")]

    # 同じ基準日の success があっても、backfill は止めない（03 §10）
    harness.ga4 = FakeGa4(scenario.ga4_responses())
    explicit = pipeline.RunRequest(
        "backfill", backfill_from=scenario.MEASUREMENT_START, backfill_to=D
    )
    assert harness.run(explicit) == 0
    assert query("select count(*) from internal.batch_run where status = 'success'") == [(2,)]
    assert query("select count(*) from internal.site_daily") == [(total_days,)]

    # daily は同じ基準日の success があれば何もしない
    capsys.readouterr()
    wp_requests = len(harness.wp.requests)
    assert harness.run() == 0
    assert {"step": "preflight", "event": "skip"} in _log_lines(capsys.readouterr().out)
    assert len(harness.wp.requests) == wp_requests
    assert query("select count(*) from internal.batch_run") == [(2,)]


def test_i_b_09_hook_is_called_once_on_success(harness: Harness, query: Query) -> None:
    assert harness.run() == 0
    assert harness.hook.call_count == 1
    assert harness.hook.calls.last.request.method == "POST"


def test_i_b_09_hook_failure_is_recorded(
    harness: Harness, query: Query, capsys: pytest.CaptureFixture[str]
) -> None:
    harness.hook.respond(500, json={"error": {"message": "internal"}})
    assert harness.run() == 1
    assert query("select status, failed_step, error_kind from internal.batch_run") == [
        ("failed", "publish", "network")
    ]
    output = capsys.readouterr().out
    assert _log_lines(output)[-1] == {"step": "publish", "kind": "network"}
    assert "https://" not in output
    assert "internal" not in output
    # 書き込みは済んでいるが、success の実行がないので公開ビューの基準日は出ない
    assert query("select count(*) from internal.site_daily") == [(7,)]
    assert query("select base_date, last_status from public.pub_meta") == [(None, "failed")]


def test_i_b_09_publish_only(
    harness: Harness,
    query: Query,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    for name in ("SUPABASE_BATCH_DB_URL", "GA4_PROPERTY_ID", "BASE_DATE"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("VERCEL_DEPLOY_HOOK_URL", scenario.HOOK_URL)
    assert cli.dispatch(["publish_only"]) == 0
    # Hook だけを呼び、取得もせず、batch_run に行を書かない
    assert harness.hook.call_count == 1
    assert not harness.wp.requests
    assert not harness.ga4.requests
    assert query("select count(*) from internal.batch_run") == [(0,)]
    assert capsys.readouterr().out == ""


def test_preflight_closes_abandoned_runs(harness: Harness, query: Query) -> None:
    # 強制終了などで running のまま残った行。2 時間より古いものだけを失敗に直す
    for hours in (3, 1):
        query(
            """
            insert into internal.batch_run (started_at, base_date, mode, status, mask_threshold)
            values (%s, %s, 'daily', 'running', 5) returning run_id
            """,
            (scenario.NOW - timedelta(hours=hours), _day(-1)),
        )
    assert harness.run() == 0
    assert query(
        """
        select status, failed_step, error_kind, finished_at is not null
        from internal.batch_run order by run_id
        """
    ) == [
        ("failed", None, "unknown", True),
        ("running", None, None, False),
        ("success", None, None, True),
    ]
