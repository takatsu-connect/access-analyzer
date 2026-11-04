"""I-DB-17 の一部: 分布と帯のビューを参照実装と突き合わせる（02 §4.1、03 §6.2）。

フィクスチャは管理接続のトランザクションの中で入れ、終了時にロールバックする。
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, timedelta

import psycopg
import pytest
from psycopg import sql

from support.reference import MIN_POPULATION, PopulationEntry, Quantiles, band, curve_point
from takatsu_batch.config import BENCHMARK_MIN_POPULATION

pytestmark = pytest.mark.db

type Admin = psycopg.Connection[tuple[object, ...]]

BASE = date(2026, 11, 1)
PARENT_CATEGORY = 1
LARGE_CATEGORY = 10
SMALL_CATEGORY = 11


@dataclass(frozen=True, slots=True)
class Post:
    post_id: int
    published_on: date
    daily_pv: int
    is_ad: bool = False
    category: int | None = None

    @property
    def age_days(self) -> int:
        return (BASE - self.published_on).days + 1

    def cumulative(self, n: int) -> int:
        """公開日を 1 日目とした n 日目の累積。1 日ごとに daily_pv ずつ増える。"""
        return self.daily_pv * n


def _insert_posts(admin: Admin, posts: Sequence[Post]) -> None:
    admin.execute(
        """
        insert into internal.wp_author (author_slug, display_name, author_url, first_seen_on)
        values ('author', '著者', 'https://takatsu-connect.com/author/author/', %s)
        """,
        (BASE,),
    )
    admin.execute(
        """
        insert into internal.wp_category (category_id, name, parent_id, path) values
          (%s, '親', null, '親'), (%s, '大', %s, '親 > 大'), (%s, '小', %s, '親 > 小')
        """,
        (PARENT_CATEGORY, LARGE_CATEGORY, PARENT_CATEGORY, SMALL_CATEGORY, PARENT_CATEGORY),
    )
    with admin.cursor() as cursor:
        cursor.executemany(
            """
            insert into internal.wp_post (
              post_id, title, post_url, author_slug, published_at, published_on, modified_at,
              is_ad, first_seen_on
            ) values (%s, 't', 'https://takatsu-connect.com/1/', 'author', %s, %s, %s, %s, %s)
            """,
            [
                (p.post_id, p.published_on, p.published_on, p.published_on, p.is_ad, BASE)
                for p in posts
            ],
        )
        cursor.executemany(
            """
            insert into internal.article_summary (
              post_id, base_date, age_days, freshness, pv_total,
              is_recent_hot, is_revival, is_evergreen_365
            ) values (%s, %s, %s, 'long', 0, false, false, false)
            """,
            [(p.post_id, BASE, p.age_days) for p in posts],
        )
        cursor.executemany(
            "insert into internal.article_daily (post_id, day, pageviews) values (%s, %s, %s)",
            [
                (p.post_id, p.published_on + timedelta(days=n - 1), p.daily_pv)
                for p in posts
                for n in range(1, min(p.age_days, 90) + 1)
            ],
        )
        cursor.executemany(
            "insert into internal.wp_post_category (post_id, category_id) values (%s, %s)",
            [(p.post_id, p.category) for p in posts if p.category is not None],
        )


def _fixture_posts() -> list[Post]:
    """母集団の境界を含む記事の集合。値は n によらず比例するので手計算でも確かめられる。"""
    posts: list[Post] = []
    next_id = 1000

    def add(
        count: int, published_on: date, *, is_ad: bool = False, category: int | None = None
    ) -> None:
        nonlocal next_id
        for index in range(count):
            posts.append(
                Post(next_id, published_on, 1 + (next_id * 7) % 23 + index % 3, is_ad, category)
            )
            next_id += 1

    # 12 か月の内側（age 40）: 30 本で 12m の母集団がちょうど足りる
    add(30, BASE - timedelta(days=39), category=LARGE_CATEGORY)
    # 基準日 − 365 日ちょうどは 12 か月に入る
    add(2, BASE - timedelta(days=365))
    # 12 か月の外
    add(5, BASE - timedelta(days=366), category=SMALL_CATEGORY)
    # 広告は入らない
    add(5, BASE - timedelta(days=50), is_ad=True, category=LARGE_CATEGORY)
    # 若い記事（n が大きいと母集団から外れる）
    add(3, BASE - timedelta(days=4))
    # age_days が小さい帯の境界
    add(1, BASE - timedelta(days=1))
    return posts


def _population(posts: Sequence[Post], n: int) -> list[Post]:
    return [p for p in posts if not p.is_ad and p.age_days >= n]


def _expected_curve(posts: Sequence[Post], scope: str, n: int) -> tuple[object, ...] | None:
    members = _population(posts, n)
    if scope.startswith("cat:"):
        category = int(scope.removeprefix("cat:"))
        members = [p for p in members if p.category == category]
    point = curve_point([PopulationEntry(p.published_on, p.cumulative(n)) for p in members], BASE)
    if point is None:
        return None
    q = point.quantiles
    return (q.p25, q.p50, q.p75, point.population_size, point.population_window)


def _curve_rows(admin: Admin) -> dict[tuple[str, int], tuple[object, ...]]:
    rows = admin.execute(
        """
        select scope, n, p25, p50, p75, population_size, population_window
        from public.pub_benchmark_curve
        """
    ).fetchall()
    return {(str(row[0]), int(str(row[1]))): tuple(row[2:]) for row in rows}


def _assert_row_matches(
    actual: tuple[object, ...] | None, expected: tuple[object, ...] | None, label: object
) -> None:
    if expected is None:
        assert actual is None, label
        return
    assert actual is not None, label
    assert actual[:3] == pytest.approx(expected[:3]), label
    assert actual[3:] == expected[3:], label


def test_min_population_matches_config_and_sql() -> None:
    assert MIN_POPULATION == BENCHMARK_MIN_POPULATION == 30


def test_curve_matches_reference(admin: Admin) -> None:
    posts = _fixture_posts()
    _insert_posts(admin, posts)
    actual = _curve_rows(admin)
    parent = f"cat:{PARENT_CATEGORY}"
    checked_12m = checked_absent = 0
    for scope in ("all", f"cat:{LARGE_CATEGORY}", f"cat:{SMALL_CATEGORY}", parent):
        for n in range(1, 91):
            expected = None if scope == parent else _expected_curve(posts, scope, n)
            _assert_row_matches(actual.get((scope, n)), expected, (scope, n))
            if expected is None:
                checked_absent += 1
            else:
                checked_12m += expected[4] == "12m"
    # フィクスチャが行あり・行なしの分岐を実際に通ったことを確かめる
    assert checked_12m > 0
    assert checked_absent > 0
    assert {scope for scope, _ in actual} == {"all", f"cat:{LARGE_CATEGORY}"}
    # age_days ちょうどの n までが母集団で、次の n で 30 本を割って行がなくなる
    assert ("all", 40) in actual
    assert ("all", 41) not in actual


def test_curve_widens_to_all_window(admin: Admin) -> None:
    # 12 か月の内側 10 本 + 外側 25 本 → 全期間 35 本
    posts = [
        Post(2000 + i, BASE - timedelta(days=100), 1 + i) for i in range(10)
    ] + [Post(3000 + i, BASE - timedelta(days=500), 2 + i) for i in range(25)]
    _insert_posts(admin, posts)
    actual = _curve_rows(admin)
    for n in (1, 30, 90):
        expected = _expected_curve(posts, "all", n)
        assert expected is not None
        assert expected[4] == "all"
        _assert_row_matches(actual.get(("all", n)), expected, n)


def test_curve_has_no_row_under_minimum(admin: Admin) -> None:
    posts = [Post(4000 + i, BASE - timedelta(days=100), 1 + i) for i in range(29)]
    _insert_posts(admin, posts)
    assert _curve_rows(admin) == {}


def _reference_curve(posts: Sequence[Post], n: int) -> Quantiles | None:
    expected = _expected_curve(posts, "all", n)
    if expected is None:
        return None
    p25, p50, p75 = expected[:3]
    assert isinstance(p25, float)
    assert isinstance(p50, float)
    assert isinstance(p75, float)
    return Quantiles(p25, p50, p75)


def test_article_bands_match_reference(admin: Admin) -> None:
    posts = _fixture_posts()
    _insert_posts(admin, posts)
    rows = admin.execute(
        "select post_id, band_7d, band_30d from public.pub_article_summary"
    ).fetchall()
    assert len(rows) == len(posts)
    by_id = {p.post_id: p for p in posts}
    seen: set[object] = set()
    for post_id, band_7d, band_30d in rows:
        post = by_id[int(str(post_id))]
        expected_7d = (
            band(post.cumulative(7), _reference_curve(posts, 7), post.age_days)
            if post.age_days >= 7
            else None
        )
        n = min(post.age_days, 30)
        expected_30d = band(post.cumulative(n), _reference_curve(posts, n), post.age_days)
        assert band_7d == expected_7d, post_id
        assert band_30d == expected_30d, post_id
        seen.update((band_7d, band_30d))
    assert {"upper", "middle", "lower", None} <= seen


def test_band_is_middle_at_quartile_boundaries(admin: Admin) -> None:
    # 全記事が同じ値なら p25 = p75 = 値 で、すべて middle
    posts = [Post(5000 + i, BASE - timedelta(days=60), 3) for i in range(30)]
    _insert_posts(admin, posts)
    rows = admin.execute(
        "select distinct band_7d, band_30d from public.pub_article_summary"
    ).fetchall()
    assert rows == [("middle", "middle")]


def test_author_band_matches_reference(admin: Admin) -> None:
    posts = _fixture_posts()
    _insert_posts(admin, posts)
    curve = _reference_curve(posts, 30)
    assert curve is not None
    for median, age in ((10_000, 30), (0, 30), (None, 30)):
        admin.execute(
            """
            insert into internal.author_summary
              (author_slug, base_date, own_median_30d, eligible_count)
            values ('author', %s, %s, 5)
            on conflict (author_slug) do update set own_median_30d = excluded.own_median_30d
            """,
            (BASE, median),
        )
        row = admin.execute("select band_30d from public.pub_author_summary").fetchone()
        assert row == (band(median, curve, age),)


def test_view_reflects_article_daily_change_without_batch(admin: Admin) -> None:
    # 07 I-DB-17: article_daily の行を変えると、次の select で曲線と帯が変わる
    posts = _fixture_posts()
    _insert_posts(admin, posts)
    before = _curve_rows(admin)[("all", 1)]
    admin.execute("update internal.article_daily set pageviews = pageviews + 100")
    after = _curve_rows(admin)[("all", 1)]
    assert before != after


def test_cumulative_excludes_days_before_publication_and_fills_gaps(admin: Admin) -> None:
    post = Post(6000, BASE - timedelta(days=2), 0)
    _insert_posts(admin, [post])
    admin.execute(
        """
        insert into internal.article_daily (post_id, day, pageviews) values
          (6000, %s, 99), (6000, %s, 5), (6000, %s, 7)
        on conflict (post_id, day) do update set pageviews = excluded.pageviews
        """,
        (
            post.published_on - timedelta(days=1),
            post.published_on,
            post.published_on + timedelta(days=2),
        ),
    )
    rows = admin.execute(
        "select n, cumulative_pv from public.pub_article_cumulative where post_id = 6000 order by n"
    ).fetchall()
    assert rows == [(1, 5), (2, 5), (3, 12)]


@pytest.mark.parametrize("view", ["pub_benchmark_curve", "pub_article_summary"])
def test_curve_performance_with_1000_posts(admin: Admin, view: str) -> None:
    # 07 I-DB-17: 1,000 本で全行 select が 2 秒以内の目安。
    # pub_article_summary は同じ曲線を読むので併せて見る。
    posts = [
        Post(10_000 + i, BASE - timedelta(days=100 + i % 200), 1 + i % 50, category=LARGE_CATEGORY)
        for i in range(1000)
    ]
    _insert_posts(admin, posts)
    admin.execute("analyze internal.article_daily")
    query = sql.SQL("explain (analyze, format json) select * from public.{}")
    plan = admin.execute(query.format(sql.Identifier(view))).fetchone()
    assert plan is not None
    execution_ms = plan[0][0]["Execution Time"]  # type: ignore[index]
    print(f"{view}: {execution_ms:.0f} ms")
    assert execution_ms < 2000, execution_ms
