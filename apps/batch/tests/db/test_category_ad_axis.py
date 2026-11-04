"""I-DB-05 の一部: 広告記事はカテゴリの広告の軸の行だけで数える（FR-40、02 §4）。

著者の合計、タグの合計、鮮度区分、公開本数には含めたままであることも確かめる。
フィクスチャは管理接続のトランザクションの中で入れ、終了時にロールバックする。
"""

from datetime import date

import psycopg
import pytest

from takatsu_batch.config import AD_CATEGORY_ID

pytestmark = pytest.mark.db

type Admin = psycopg.Connection[tuple[object, ...]]

ARTICLE_AXIS = 1
ARTICLE_CHILD = 2
AD_ONLY_ELSEWHERE = 3
AD_AXIS = AD_CATEGORY_ID
AD_CHILD = 189
NORMAL_POST = 101
AD_POST_ON_PARENT = 102
AD_POST_ON_CHILD = 103
PERIOD = "last7"
PUBLISHED_ON = date(2026, 10, 1)
BASE = date(2026, 11, 5)
TAG = 7


@pytest.fixture
def fixture_rows(admin: Admin) -> None:
    admin.execute(
        """
        insert into internal.wp_author (author_slug, display_name, author_url, first_seen_on)
        values ('a', 'A', 'https://takatsu-connect.com/author/a/', %(base)s)
        """,
        {"base": BASE},
    )
    admin.execute(
        """
        insert into internal.wp_category (category_id, name, parent_id, path) values
          (%(article)s, '記事', null, '記事'),
          (%(child)s, '子', %(article)s, '記事 > 子'),
          (%(elsewhere)s, '別', %(article)s, '記事 > 別'),
          (%(ad)s, '広告', null, '広告'),
          (%(ad_child)s, '広告の子', %(ad)s, '広告 > 広告の子')
        """,
        {
            "article": ARTICLE_AXIS,
            "child": ARTICLE_CHILD,
            "elsewhere": AD_ONLY_ELSEWHERE,
            "ad": AD_AXIS,
            "ad_child": AD_CHILD,
        },
    )
    admin.execute(
        """
        insert into internal.period (period_id, kind, start_date, end_date, base_date, is_confirmed)
        values (%s, 'window', %s, %s, %s, false)
        """,
        (PERIOD, PUBLISHED_ON, BASE, BASE),
    )
    with admin.cursor() as cursor:
        cursor.executemany(
            """
            insert into internal.wp_post (
              post_id, title, post_url, author_slug, published_at, published_on, modified_at,
              is_ad, first_seen_on
            ) values (%s, 't', 'https://takatsu-connect.com/1/', 'a', %s, %s, %s, %s, %s)
            """,
            [
                (post_id, PUBLISHED_ON, PUBLISHED_ON, PUBLISHED_ON, is_ad, BASE)
                for post_id, is_ad in (
                    (NORMAL_POST, False),
                    (AD_POST_ON_PARENT, True),
                    (AD_POST_ON_CHILD, True),
                )
            ],
        )
        cursor.executemany(
            "insert into internal.wp_post_category (post_id, category_id) values (%s, %s)",
            [
                (NORMAL_POST, ARTICLE_CHILD),
                (AD_POST_ON_PARENT, ARTICLE_AXIS),
                (AD_POST_ON_PARENT, AD_AXIS),
                (AD_POST_ON_CHILD, ARTICLE_CHILD),
                (AD_POST_ON_CHILD, AD_ONLY_ELSEWHERE),
                (AD_POST_ON_CHILD, AD_CHILD),
            ],
        )
        cursor.executemany(
            """
            insert into internal.article_period (
              post_id, period_id, pageviews, landing_sessions, scroll_count, engagement_seconds
            ) values (%s, %s, %s, 0, 0, 0)
            """,
            [
                (NORMAL_POST, PERIOD, 10),
                (AD_POST_ON_PARENT, PERIOD, 100),
                (AD_POST_ON_CHILD, PERIOD, 1000),
            ],
        )
        cursor.executemany(
            """
            insert into internal.article_summary (
              post_id, base_date, age_days, freshness, pv_30d, pv_total,
              is_recent_hot, is_revival, is_evergreen_365
            ) values (%s, %s, 36, 'mid', %s, 0, false, false, false)
            """,
            [
                (NORMAL_POST, BASE, 10),
                (AD_POST_ON_PARENT, BASE, 100),
                (AD_POST_ON_CHILD, BASE, 1000),
            ],
        )
        admin.execute("insert into internal.wp_tag (tag_id, name) values (%s, 'タグ')", (TAG,))
        cursor.executemany(
            "insert into internal.wp_post_tag (post_id, tag_id) values (%s, %s)",
            [(NORMAL_POST, TAG), (AD_POST_ON_PARENT, TAG)],
        )


@pytest.mark.usefixtures("fixture_rows")
def test_category_period_counts_ads_only_on_ad_axis(admin: Admin) -> None:
    rows = admin.execute(
        """
        select category_id, pageviews, post_count_total, post_count_published,
               median_30d_pv, published_post_count_30d
        from public.pub_category_period
        where period_id = %s
        """,
        (PERIOD,),
    ).fetchall()
    assert {row[0]: row[1:] for row in rows} == {
        # 広告以外の軸: 親も子も通常の記事だけ
        ARTICLE_AXIS: (10, 1, 1, 10.0, 1),
        ARTICLE_CHILD: (10, 1, 1, 10.0, 1),
        # 広告の軸: 親は配下の子の記事も distinct で数える
        AD_AXIS: (1100, 2, 2, 550.0, 2),
        AD_CHILD: (1000, 1, 1, 1000.0, 1),
    }


@pytest.mark.usefixtures("fixture_rows")
def test_category_with_only_ad_posts_has_no_row_outside_ad_axis(admin: Admin) -> None:
    rows = admin.execute(
        "select 1 from public.pub_category_period where category_id = %s",
        (AD_ONLY_ELSEWHERE,),
    ).fetchall()
    assert rows == []


@pytest.mark.usefixtures("fixture_rows")
def test_author_category_period_counts_ads_only_on_ad_axis(admin: Admin) -> None:
    rows = admin.execute(
        """
        select category_id, post_count, pageviews
        from public.pub_author_category_period
        where author_slug = 'a' and period_id = %s
        """,
        (PERIOD,),
    ).fetchall()
    assert {row[0]: row[1:] for row in rows} == {
        ARTICLE_CHILD: (1, 10),
        AD_AXIS: (1, 100),
        AD_CHILD: (1, 1000),
    }


@pytest.mark.usefixtures("fixture_rows")
def test_other_totals_still_include_ads(admin: Admin) -> None:
    author = admin.execute(
        "select post_count, pageviews from public.pub_author_period where period_id = %s",
        (PERIOD,),
    ).fetchall()
    assert author == [(3, 1110)]

    tag = admin.execute(
        "select post_count, pageviews from public.pub_tag_period where period_id = %s",
        (PERIOD,),
    ).fetchall()
    assert tag == [(2, 110)]

    freshness = admin.execute(
        "select post_count, pageviews from public.pub_site_period_freshness where period_id = %s",
        (PERIOD,),
    ).fetchall()
    assert freshness == [(3, 1110)]

    posting = admin.execute(
        "select post_count from public.pub_posting_period where period_id = %s",
        (PERIOD,),
    ).fetchall()
    assert posting == [(3,)]


def test_ad_category_id_matches_view_definition(admin: Admin) -> None:
    rows = admin.execute(
        """
        select viewname, definition from pg_views
        where schemaname = 'public'
          and viewname in ('pub_category_period', 'pub_author_category_period')
        """
    ).fetchall()
    assert len(rows) == 2
    for name, definition in rows:
        assert f"= {AD_CATEGORY_ID}" in str(definition), name
