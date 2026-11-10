"""I-DB-17 の一部: 記事の種類（記事、イベント）ごとの分布と帯（02 §4.1）。

2026-11-10 の依頼者の決定による。

種類は親カテゴリで決める。親 ARTICLE_CATEGORY_ID またはその子に属すれば記事、
親 EVENT_CATEGORY_ID またはその子に属すればイベント。両方に属する記事は両方の母集団に入る。
帯は記事の主な種類（記事 → イベント → all の順）の曲線と比べる。
フィクスチャは管理接続のトランザクションの中で入れ、終了時にロールバックする。
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, timedelta

import psycopg
import pytest
from psycopg import sql

from support.reference import PopulationEntry, Quantiles, band, curve_point
from takatsu_batch.config import ARTICLE_CATEGORY_ID, EVENT_CATEGORY_ID

pytestmark = pytest.mark.db

type Admin = psycopg.Connection[tuple[object, ...]]

BASE = date(2026, 11, 1)
ARTICLE = ARTICLE_CATEGORY_ID
EVENT = EVENT_CATEGORY_ID
ARTICLE_CHILD = 110
EVENT_CHILD = 90
OTHER_PARENT = 24
AD_PARENT = 188
KINDS = ("kind:article", "kind:event")


@dataclass(frozen=True, slots=True)
class Post:
    post_id: int
    published_on: date
    daily_pv: int
    categories: tuple[int, ...] = ()
    is_ad: bool = False

    @property
    def age_days(self) -> int:
        return (BASE - self.published_on).days + 1

    @property
    def parents(self) -> set[int]:
        children = {ARTICLE_CHILD: ARTICLE, EVENT_CHILD: EVENT}
        return {children.get(category, category) for category in self.categories}

    @property
    def primary_scope(self) -> str:
        if ARTICLE in self.parents:
            return "kind:article"
        if EVENT in self.parents:
            return "kind:event"
        return "all"

    def cumulative(self, n: int) -> int:
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
          (%(article)s, '記事', null, '記事'),
          (%(article_child)s, '記事の子', %(article)s, '記事 > 記事の子'),
          (%(event)s, 'イベント', null, 'イベント'),
          (%(event_child)s, 'イベントの子', %(event)s, 'イベント > イベントの子'),
          (%(other)s, 'マップ', null, 'マップ'),
          (%(ad)s, '広告', null, '広告')
        """,
        {
            "article": ARTICLE,
            "article_child": ARTICLE_CHILD,
            "event": EVENT,
            "event_child": EVENT_CHILD,
            "other": OTHER_PARENT,
            "ad": AD_PARENT,
        },
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
            [(p.post_id, category) for p in posts for category in p.categories],
        )


def _fixture_posts() -> list[Post]:
    """記事は読まれ方が大きく、イベントは小さく、ほかは中くらいにして、曲線の取り違えが帯に出るようにする。

    - 記事: 子 20 本 + 親に直接 12 本 + 両方 4 本 = 36 本
      （親に直接付いた記事を数えないと 24 本で行がない）
    - イベント: 子 25 本 + 親に直接 3 本 + 両方 4 本 = 32 本
      （両方の記事を数えないと 28 本で行がない）
    - 広告（記事 + 広告）5 本は記事の母集団に入らない（入ると 41 本）
    """
    posts: list[Post] = []
    next_id = 20_000

    def add(
        count: int,
        low: int,
        high: int,
        categories: tuple[int, ...],
        *,
        is_ad: bool = False,
        age: int = 40,
    ) -> None:
        nonlocal next_id
        for index in range(count):
            daily_pv = low + (index * 7) % (high - low + 1)
            published_on = BASE - timedelta(days=age - 1)
            posts.append(Post(next_id, published_on, daily_pv, categories, is_ad))
            next_id += 1

    add(20, 50, 80, (ARTICLE_CHILD,))
    add(12, 50, 80, (ARTICLE,))
    add(25, 1, 20, (EVENT_CHILD,))
    add(3, 1, 20, (EVENT,))
    # 記事とイベントの両方。記事の曲線では下、イベントの曲線では上に出る値
    add(4, 30, 30, (ARTICLE_CHILD, EVENT_CHILD))
    add(5, 50, 80, (ARTICLE_CHILD, AD_PARENT), is_ad=True)
    # どちらにも属さない記事（カテゴリなしを含む）
    add(28, 20, 60, (OTHER_PARENT,))
    add(2, 20, 60, ())
    # 若い記事（帯の境界）
    add(1, 50, 50, (ARTICLE_CHILD,), age=5)
    return posts


def _members(posts: Sequence[Post], scope: str, n: int) -> list[Post]:
    members = [p for p in posts if not p.is_ad and p.age_days >= n]
    if scope == "kind:article":
        return [p for p in members if ARTICLE in p.parents]
    if scope == "kind:event":
        return [p for p in members if EVENT in p.parents]
    assert scope == "all"
    return members


def _expected_curve(posts: Sequence[Post], scope: str, n: int) -> tuple[object, ...] | None:
    members = _members(posts, scope, n)
    point = curve_point([PopulationEntry(p.published_on, p.cumulative(n)) for p in members], BASE)
    if point is None:
        return None
    q = point.quantiles
    return (q.p25, q.p50, q.p75, point.population_size, point.population_window)


def _reference_quantiles(posts: Sequence[Post], scope: str, n: int) -> Quantiles | None:
    expected = _expected_curve(posts, scope, n)
    if expected is None:
        return None
    p25, p50, p75 = expected[:3]
    assert isinstance(p25, float)
    assert isinstance(p50, float)
    assert isinstance(p75, float)
    return Quantiles(p25, p50, p75)


def _curve_rows(admin: Admin) -> dict[tuple[str, int], tuple[object, ...]]:
    rows = admin.execute(
        """
        select scope, n, p25, p50, p75, population_size, population_window
        from public.pub_benchmark_curve
        """
    ).fetchall()
    return {(str(row[0]), int(str(row[1]))): tuple(row[2:]) for row in rows}


def _expected_band(posts: Sequence[Post], post: Post, scope: str, n: int) -> object:
    return band(post.cumulative(n), _reference_quantiles(posts, scope, n), post.age_days)


def test_kind_curves_match_reference(admin: Admin) -> None:
    posts = _fixture_posts()
    _insert_posts(admin, posts)
    actual = _curve_rows(admin)
    for scope in (*KINDS, "all"):
        for n in range(1, 91):
            expected = _expected_curve(posts, scope, n)
            row = actual.get((scope, n))
            if expected is None:
                assert row is None, (scope, n)
                continue
            assert row is not None, (scope, n)
            assert row[:3] == pytest.approx(expected[:3]), (scope, n)
            assert row[3:] == expected[3:], (scope, n)
    # 親に直接付いた記事と両方の記事を含み、広告を除いた本数（n = 10 で若い記事は外れる）
    assert actual[("kind:article", 10)][3:] == (36, "12m")
    assert actual[("kind:event", 10)][3:] == (32, "12m")
    # age 40 の記事が母集団で、次の n で 30 本を割って行がなくなる
    assert ("kind:article", 40) in actual
    assert ("kind:article", 41) not in actual
    # 子カテゴリの scope は変わらない（30 本以上の子だけ）
    assert {scope for scope, _ in actual} == {"all", *KINDS}


def test_kind_curve_needs_minimum_population(admin: Admin) -> None:
    # イベント 29 本では行がなく、all（29 本 + 記事 1 本）には行がある
    published_on = BASE - timedelta(days=99)
    posts = [Post(30_000 + i, published_on, 1 + i, (EVENT_CHILD,)) for i in range(29)]
    posts.append(Post(30_100, published_on, 5, (ARTICLE,)))
    _insert_posts(admin, posts)
    scopes = {scope for scope, _ in _curve_rows(admin)}
    assert scopes == {"all"}


def test_bands_use_primary_kind_curve(admin: Admin) -> None:
    posts = _fixture_posts()
    _insert_posts(admin, posts)
    rows = admin.execute(
        "select post_id, band_7d, band_30d from public.pub_article_summary"
    ).fetchall()
    assert len(rows) == len(posts)
    by_id = {p.post_id: p for p in posts}
    differs_from_all = 0
    for post_id, band_7d, band_30d in rows:
        post = by_id[int(str(post_id))]
        scope = post.primary_scope
        expected_7d = _expected_band(posts, post, scope, 7) if post.age_days >= 7 else None
        n = min(post.age_days, 30)
        expected_30d = _expected_band(posts, post, scope, n)
        assert (band_7d, band_30d) == (expected_7d, expected_30d), (post_id, scope)
        differs_from_all += expected_30d != _expected_band(posts, post, "all", n)
    # フィクスチャが「all と比べたら別の帯」になる記事を実際に含むことを確かめる
    assert differs_from_all > 0


def test_post_in_both_kinds_uses_article_curve(admin: Admin) -> None:
    posts = _fixture_posts()
    _insert_posts(admin, posts)
    both = [p for p in posts if {ARTICLE, EVENT} <= p.parents]
    assert both
    rows = admin.execute(
        "select band_7d, band_30d from public.pub_article_summary where post_id = any(%s)",
        ([p.post_id for p in both],),
    ).fetchall()
    # 記事の曲線では下、イベントの曲線では上
    assert _expected_band(posts, both[0], "kind:event", 30) == "upper"
    assert set(rows) == {("lower", "lower")}


def test_post_without_kind_uses_all_curve(admin: Admin) -> None:
    posts = _fixture_posts()
    _insert_posts(admin, posts)
    others = [p for p in posts if p.primary_scope == "all"]
    assert len(others) == 30
    rows = admin.execute(
        "select post_id, band_30d from public.pub_article_summary where post_id = any(%s)",
        ([p.post_id for p in others],),
    ).fetchall()
    by_id = {p.post_id: p for p in others}
    for post_id, band_30d in rows:
        post = by_id[int(str(post_id))]
        assert band_30d == _expected_band(posts, post, "all", 30), post_id
    assert len(rows) == len(others)


def test_band_is_null_when_kind_curve_is_missing(admin: Admin) -> None:
    # イベントが 29 本で曲線がなければ、all の曲線があっても帯は出さない（all に戻さない）
    published_on = BASE - timedelta(days=99)
    events = [Post(31_000 + i, published_on, 1 + i, (EVENT_CHILD,)) for i in range(29)]
    others = [Post(31_100 + i, published_on, 1 + i, (OTHER_PARENT,)) for i in range(5)]
    _insert_posts(admin, [*events, *others])
    rows = admin.execute(
        "select post_id, band_7d, band_30d from public.pub_article_summary"
    ).fetchall()
    by_id = {int(str(row[0])): row[1:] for row in rows}
    assert all(by_id[p.post_id] == (None, None) for p in events)
    assert all(by_id[p.post_id] != (None, None) for p in others)


@pytest.mark.parametrize(
    ("view", "category_id"),
    [
        ("internal.benchmark_curve", ARTICLE_CATEGORY_ID),
        ("internal.benchmark_curve", EVENT_CATEGORY_ID),
        ("public.pub_article_summary", ARTICLE_CATEGORY_ID),
        ("public.pub_article_summary", EVENT_CATEGORY_ID),
    ],
)
def test_kind_category_ids_match_view_definition(admin: Admin, view: str, category_id: int) -> None:
    row = admin.execute("select pg_get_viewdef(%s::regclass)", (view,)).fetchone()
    assert row is not None
    assert f"({category_id} = ANY (" in str(row[0])


@pytest.mark.parametrize("empty_stats", [False, True])
@pytest.mark.parametrize("view", ["pub_benchmark_curve", "pub_article_summary"])
def test_kind_curve_performance_with_1000_posts(admin: Admin, view: str, empty_stats: bool) -> None:
    # 07 I-DB-17 の目安（1,000 本で 2 秒以内）を、種類の母集団があるときにも確かめる
    categories = ((ARTICLE_CHILD,), (EVENT,), (ARTICLE, EVENT_CHILD), (OTHER_PARENT,))
    posts = [
        Post(40_000 + i, BASE - timedelta(days=100 + i % 200), 1 + i % 50, categories[i % 4])
        for i in range(1000)
    ]
    if empty_stats:
        # test_benchmark_curve.py の同名の検査と同じ手順で、統計を「ページはあるが 0 行」にする
        admin.execute("savepoint before_fixture")
        _insert_posts(admin, posts)
        admin.execute("rollback to savepoint before_fixture")
        for table in ("wp_post", "article_summary", "wp_category", "wp_post_category"):
            admin.execute(sql.SQL("analyze {}").format(sql.Identifier("internal", table)))
    _insert_posts(admin, posts)
    admin.execute("analyze internal.article_daily")
    query = sql.SQL("explain (analyze, timing off, format json) select * from public.{}")
    plan = admin.execute(query.format(sql.Identifier(view))).fetchone()
    assert plan is not None
    execution_ms = plan[0][0]["Execution Time"]  # type: ignore[index]
    print(f"{view} empty_stats={empty_stats}: {execution_ms:.0f} ms")
    assert execution_ms < 2000, execution_ms
