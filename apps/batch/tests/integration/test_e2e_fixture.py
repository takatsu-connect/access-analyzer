"""E2E のフィクスチャ（support.e2e_fixture）に、画面の場面が入っていることを確かめる（07 §10）。

固定の基準日で、読み込みコマンドと同じ関数（`run_backfill`）を 1 回動かし、公開ビュー
（`public.pub_*`）を管理接続で読む。値の細部ではなく、場面が存在することを確かめる。
記事 ID と場面の対応は support/e2e_fixture.py の冒頭の表にある。

| ID | 確かめること |
| --- | --- |
| FX-01 | 記事 42 本、著者 4 人、広告 1 本。公開 2・7・29・30 日目の記事がある |
| FX-02 | 全記事の分布（scope = all、n = 30）の母集団が 30 本以上 |
| FX-03 | band_30d に upper、middle、lower、null がすべて現れる。公開 2 日目は null |
| FX-04 | 計測開始前の記事は累積の行がなく、pv_30d が null、is_evergreen_365 が true |
| FX-05 | 最近よく読まれている記事と、久しぶりに読まれた記事がある |
| FX-06 | 節目の 500 と 1,000 が、直近 28 日の間にある |
| FX-07 | author-b は「これまでの記事」の中央値が出て、author-d は出ない |
| FX-08 | author-c は last28 に公開が 0 本で、読まれた回数がある |
| FX-09 | 全体の伏せ値の場面（SNS、初めて・また来た、曜日 × 時間帯、地元） |
| FX-10 | author-a の流入チャネルに null が 2 つ以上（階層差分と二次伏せ） |
| FX-11 | last28 の読まれた回数が 19 の記事と 20 の記事がある |
| FX-12 | 確定月の参照元ドメインと市別が、月ごとに 3 行以上 |
| FX-13 | 記事のない子カテゴリとタグは、期間別の行がない |
| FX-14 | pub_meta の base_date が基準日で、last_status が success |
| FX-15 | 全体の日別が、計測開始日から基準日まで欠けていない。期間別の全体の値がすべての期間にある |
| FX-16 | scroll が伏さる記事と、公開後 30 日時点のリンク元が 2 つ以上の記事がある |
| FX-17 | フィクスチャは同じ基準日なら同じで、偽の GA4 に渡す次元の組が一意 |
| FX-18 | --stale は実行時刻を 6 日前にする |
"""

from collections.abc import Callable, Iterator, Sequence
from datetime import UTC, date, datetime, timedelta
from typing import Any

import psycopg
import pytest

from support import e2e_fixture
from support.load_e2e_fixture import resolve_now, run_backfill
from support.localdb import truncate_internal_tables

pytestmark = pytest.mark.db

type Query = Callable[..., list[tuple[Any, ...]]]

BASE_DATE = date(2026, 11, 3)
# JST 17:00 の実行。基準日は前日
NOW = datetime(2026, 11, 4, 8, 0, tzinfo=UTC)
LAST28_START = BASE_DATE - timedelta(days=27)


@pytest.fixture(scope="module")
def q(admin_url: str, batch_writer_url: str) -> Iterator[Query]:
    """フィクスチャを 1 回読み込み、管理接続で読む関数を返す。終わったら内部表を空に戻す。"""

    def run(statement: str, params: Sequence[Any] = ()) -> list[tuple[Any, ...]]:
        with psycopg.connect(admin_url, autocommit=True) as conn:
            return conn.execute(statement.encode(), params).fetchall()

    truncate_internal_tables(admin_url)
    try:
        exit_code = run_backfill(batch_writer_url, NOW)
        runs = run("select status, failed_step, error_kind from public.pub_batch_run")
        assert exit_code == 0, f"読み込みのバッチが失敗した: {runs}"
        yield run
    finally:
        truncate_internal_tables(admin_url)


def _null_count(q: Query, view: str, column: str, where: str, params: Sequence[Any]) -> int:
    rows = q(f"select count(*) from public.{view} where {column} is null and {where}", params)
    return int(rows[0][0])


def test_fx01_posts_and_authors(q: Query) -> None:
    assert q("select count(*), count(*) filter (where is_ad) from public.pub_post") == [(42, 1)]
    assert [row[0] for row in q("select author_slug from public.pub_author order by 1")] == [
        "author-a",
        "author-b",
        "author-c",
        "author-d",
    ]
    ages: dict[int, int] = dict(
        q("select post_id, age_days from public.pub_post where post_id between 101 and 104")
    )
    assert ages == {101: 2, 102: 7, 103: 29, 104: 30}


def test_fx02_benchmark_population(q: Query) -> None:
    rows = q(
        "select population_size from public.pub_benchmark_curve where scope = 'all' and n = 30"
    )
    assert len(rows) == 1
    assert rows[0][0] >= 30


def test_fx03_bands(q: Query) -> None:
    bands: dict[int, str | None] = dict(
        q("select post_id, band_30d from public.pub_article_summary")
    )
    assert len(bands) == 42
    assert set(bands.values()) == {"upper", "middle", "lower", None}
    assert bands[101] is None


def test_fx04_pre_measurement_post(q: Query) -> None:
    post_id = e2e_fixture.PRE_MEASUREMENT_POST_ID
    assert q(
        "select count(*) from public.pub_article_cumulative where post_id = %s", [post_id]
    ) == [(0,)]
    assert q(
        "select pv_30d, is_evergreen_365 from public.pub_article_summary where post_id = %s",
        [post_id],
    ) == [(None, True)]


def test_fx05_recent_hot_and_revival(q: Query) -> None:
    flags = {
        row[0]: (row[1], row[2])
        for row in q("select post_id, is_recent_hot, is_revival from public.pub_article_summary")
    }
    assert flags[105][0] is True
    assert flags[106][1] is True


def test_fx06_milestones(q: Query) -> None:
    rows = q(
        "select post_id, milestone from public.pub_article_milestone "
        "where reached_on between %s and %s",
        [LAST28_START, BASE_DATE],
    )
    assert (103, 500) in rows
    assert (104, 1000) in rows


def test_fx07_own_median(q: Query) -> None:
    medians: dict[str, float | None] = dict(
        q("select author_slug, own_median_30d from public.pub_author_summary")
    )
    assert medians["author-b"] is not None
    assert medians["author-d"] is None


def test_fx08_author_without_recent_post(q: Query) -> None:
    rows = q(
        "select post_count, pageviews from public.pub_author_period "
        "where author_slug = 'author-c' and period_id = 'last28'"
    )
    assert len(rows) == 1
    post_count, pageviews = rows[0]
    assert post_count == 0
    assert pageviews >= 1


@pytest.mark.parametrize(
    ("period_id", "axis", "expected"),
    [("last28", "sns", 2), ("last7", "sns", 1), ("last90", "local", 2)],
)
def test_fx09_site_breakdown_masks(q: Query, period_id: str, axis: str, expected: int) -> None:
    where = "period_id = %s and axis = %s"
    assert (
        _null_count(q, "pub_site_period_breakdown", "value", where, [period_id, axis]) == expected
    )


def test_fx09_heatmap_and_zero(q: Query) -> None:
    assert _null_count(q, "pub_site_period_heatmap", "pageviews", "period_id = %s", ["last28"]) == 2
    assert q(
        "select value from public.pub_site_period_breakdown "
        "where period_id = 'last28' and axis = 'new_returning' and bucket = 'unknown'"
    ) == [(0,)]


def test_fx10_author_hierarchy_mask(q: Query) -> None:
    where = "author_slug = %s and period_id = %s and axis = %s"
    params = ["author-a", "last28", "channel"]
    assert _null_count(q, "pub_author_period_breakdown", "sessions", where, params) >= 2


def test_fx11_denominator_boundary(q: Query) -> None:
    rows = q(
        "select post_id, pageviews from public.pub_article_period "
        "where period_id = 'last28' and pageviews in (19, 20)"
    )
    assert (109, 19) in rows
    assert (110, 20) in rows


def test_fx12_confirmed_month_tables(q: Query) -> None:
    months = [
        row[0]
        for row in q(
            "select period_id from public.pub_period where period_id like 'm%%' and is_confirmed"
        )
    ]
    assert len(months) >= 12
    for view in ("pub_site_month_referrer", "pub_site_month_city"):
        counts: dict[str, int] = dict(
            q(f"select period_id, count(*) from public.{view} group by period_id")
        )
        assert {month: counts.get(month, 0) >= 3 for month in months} == dict.fromkeys(months, True)


def test_fx13_empty_category_and_tag(q: Query) -> None:
    categories = {
        row[0] for row in q("select distinct category_id from public.pub_category_period")
    }
    tags = {row[0] for row in q("select distinct tag_id from public.pub_tag_period")}
    assert e2e_fixture.CHILD_EMPTY not in categories
    assert {e2e_fixture.CHILD_TOPIC, e2e_fixture.CHILD_SHOP, e2e_fixture.CHILD_SEASON} <= categories
    assert tags == {e2e_fixture.TAG_WALK, e2e_fixture.TAG_FAMILY}


def test_fx14_meta(q: Query) -> None:
    assert q("select base_date, last_status from public.pub_meta") == [(BASE_DATE, "success")]


def test_fx15_site_daily_and_periods(q: Query) -> None:
    days = (BASE_DATE - e2e_fixture.MEASUREMENT_START).days + 1
    assert q("select count(*), min(day), max(day) from public.pub_site_daily") == [
        (days, e2e_fixture.MEASUREMENT_START, BASE_DATE)
    ]
    periods = {row[0] for row in q("select period_id from public.pub_period")}
    assert {"last7", "prev7", "last28", "prev28", "last90", "prev90"} <= periods
    with_users = {
        row[0]
        for row in q("select period_id from public.pub_site_period where active_users is not null")
    }
    assert with_users == periods
    for axis in ("channel", "sns", "device_pv", "device_sessions", "local", "new_returning"):
        with_axis = {
            row[0]
            for row in q(
                "select distinct period_id from public.pub_site_period_breakdown where axis = %s",
                [axis],
            )
        }
        assert with_axis == periods, axis
    with_heatmap = {
        row[0] for row in q("select distinct period_id from public.pub_site_period_heatmap")
    }
    assert with_heatmap == periods


def test_fx16_article_scroll_mask_and_referrers(q: Query) -> None:
    assert q(
        "select pageviews is not null, scroll_count from public.pub_article_period "
        "where post_id = 111 and period_id = 'last28'"
    ) == [(True, None)]
    referrers: dict[int, int] = dict(
        q("select post_id, count(*) from public.pub_article_referrer_30d group by post_id")
    )
    assert referrers.get(111, 0) >= 2
    assert referrers.get(112, 0) >= 2


def test_fx17_fixture_is_deterministic_and_unique() -> None:
    responses = e2e_fixture.ga4_responses(BASE_DATE)
    assert responses == e2e_fixture.ga4_responses(BASE_DATE)
    assert e2e_fixture.build_wp(BASE_DATE).posts == e2e_fixture.build_wp(BASE_DATE).posts
    for query_id, by_range in responses.items():
        for range_name, rows in by_range.items():
            keys = [tuple(sorted(dimensions.items())) for dimensions, _ in rows]
            assert len(keys) == len(set(keys)), (query_id, range_name)


def test_fx18_stale_shifts_now() -> None:
    assert resolve_now(NOW, stale=False) == NOW
    assert resolve_now(NOW, stale=True) == NOW - timedelta(days=6)
