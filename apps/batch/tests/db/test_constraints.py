"""監査 M-2、M-3: 伏せ値の整合と運用表の値を DB の制約で保証する（02 §2.3、§3.4、§3.6）。"""

from datetime import date
from decimal import Decimal
from typing import get_args

import psycopg
import pytest
from psycopg import errors

from takatsu_batch.config import MASK_THRESHOLD
from takatsu_batch.log import ErrorKind, Step

pytestmark = pytest.mark.db

type Admin = psycopg.Connection[tuple[object, ...]]

DAY = date(2026, 1, 1)
TOP_N_TABLES = ("site_month_referrer", "site_month_city", "article_referrer_30d")


def _constraints(admin: Admin, table: str) -> list[str]:
    rows = admin.execute(
        """
        select pg_get_constraintdef(c.oid)
        from pg_constraint c
        where c.conrelid = %s::regclass and c.contype = 'c'
        """,
        (f"internal.{table}",),
    ).fetchall()
    return [str(row[0]) for row in rows]


def test_every_mask_column_has_consistency_check(admin: Admin) -> None:
    columns = admin.execute(
        """
        select table_name, column_name from information_schema.columns
        where table_schema = 'internal' and column_name like '%\\_mask'
        """
    ).fetchall()
    assert len(columns) == 11
    for table, mask_column in columns:
        value_column = str(mask_column).removesuffix("_mask")
        expected = f"(({mask_column} IS NULL) = ({value_column} IS NOT NULL))"
        assert any(expected in definition for definition in _constraints(admin, str(table))), (
            table,
            mask_column,
        )


@pytest.mark.parametrize(
    ("sessions", "mask"),
    [(3, "threshold"), (9, "secondary"), (0, "threshold"), (None, None)],
)
def test_mask_and_value_must_agree(admin: Admin, sessions: int | None, mask: str | None) -> None:
    with pytest.raises(errors.CheckViolation), admin.transaction():
        admin.execute(
            """
            insert into internal.site_daily_channel (day, channel, sessions, sessions_mask)
            values (%s, 'search', %s, %s)
            """,
            (DAY, sessions, mask),
        )


@pytest.mark.parametrize(
    ("sessions", "mask"),
    # T の値は制約に書かないので、3 も mask なしで通る（規則は mask.py が持つ）
    [(None, "threshold"), (None, "secondary"), (0, None), (3, None), (9, None)],
)
def test_consistent_mask_is_accepted(admin: Admin, sessions: int | None, mask: str | None) -> None:
    admin.execute(
        """
        insert into internal.site_daily_channel (day, channel, sessions, sessions_mask)
        values (%s, 'search', %s, %s)
        """,
        (DAY, sessions, mask),
    )


@pytest.mark.parametrize("table", TOP_N_TABLES)
def test_top_n_lower_bound_matches_config(admin: Admin, table: str) -> None:
    definitions = _constraints(admin, table)
    assert any(f"(sessions >= {MASK_THRESHOLD})" in definition for definition in definitions)


def _insert_post(admin: Admin) -> None:
    admin.execute(
        """
        insert into internal.wp_author (author_slug, display_name, author_url, first_seen_on)
        values ('a', 'A', 'https://takatsu-connect.com/author/a/', %(day)s)
        """,
        {"day": DAY},
    )
    admin.execute(
        """
        insert into internal.wp_post (
          post_id, title, post_url, author_slug, published_at, published_on, modified_at,
          first_seen_on
        ) values (1, 't', 'https://takatsu-connect.com/1/', 'a', %(day)s, %(day)s, %(day)s, %(day)s)
        """,
        {"day": DAY},
    )


def _insert_month(admin: Admin) -> None:
    admin.execute(
        """
        insert into internal.period (period_id, kind, start_date, end_date, base_date, is_confirmed)
        values ('m2026-01', 'month', %(day)s, %(day)s, %(day)s, true)
        """,
        {"day": DAY},
    )


def _top_n_insert(table: str) -> bytes:
    statements = {
        "site_month_referrer": """
            insert into internal.site_month_referrer (period_id, rank, source_domain, sessions)
            values ('m2026-01', 1, 'example.com', %s)
        """,
        "site_month_city": """
            insert into internal.site_month_city (period_id, rank, country, region, city, sessions)
            values ('m2026-01', 1, 'Japan', 'Kanagawa', 'Kawasaki', %s)
        """,
        "article_referrer_30d": """
            insert into internal.article_referrer_30d
              (post_id, rank, source_domain, sessions, computed_on)
            values (1, 1, 'example.com', %s, '2026-01-01')
        """,
    }
    return statements[table].encode()


@pytest.mark.parametrize("table", TOP_N_TABLES)
def test_top_n_rejects_rows_below_threshold(admin: Admin, table: str) -> None:
    _insert_post(admin)
    _insert_month(admin)
    with pytest.raises(errors.CheckViolation), admin.transaction():
        admin.execute(_top_n_insert(table), (MASK_THRESHOLD - 1,))
    admin.execute(_top_n_insert(table), (MASK_THRESHOLD,))


def _insert_run(admin: Admin, failed_step: str | None, error_kind: str | None) -> None:
    admin.execute(
        """
        insert into internal.batch_run
          (started_at, base_date, mode, status, failed_step, error_kind, mask_threshold)
        values (now(), %s, 'daily', 'failed', %s, %s, 5)
        """,
        (DAY, failed_step, error_kind),
    )


def test_failed_step_accepts_pipeline_steps_only(admin: Admin) -> None:
    # log.py の Step から、batch_run に書けない段階の startup を除いたものと一致する（03 §1）
    steps = set(get_args(Step.__value__)) - {"startup"}
    assert len(steps) == 8
    for step in sorted(steps):
        _insert_run(admin, step, "db")
    _insert_run(admin, None, None)


@pytest.mark.parametrize(
    "value",
    ["startup", "postgresql://batch_writer:secret@pooler.example:5432/postgres", "WRITE", ""],
)
def test_failed_step_rejects_other_values(admin: Admin, value: str) -> None:
    with pytest.raises(errors.CheckViolation), admin.transaction():
        _insert_run(admin, value, None)


def test_error_kind_accepts_log_kinds_only(admin: Admin) -> None:
    for kind in get_args(ErrorKind.__value__):
        _insert_run(admin, "write", kind)
    with pytest.raises(errors.CheckViolation), admin.transaction():
        _insert_run(admin, "write", "connection failed at pooler.example")


def test_own_median_keeps_half_values(admin: Admin) -> None:
    # 記事数が偶数のとき中央値は .5 になる（レビュー 低-1）
    _insert_post(admin)
    admin.execute(
        """
        insert into internal.author_summary (author_slug, base_date, own_median_30d, eligible_count)
        values ('a', %s, 12.5, 6)
        """,
        (DAY,),
    )
    row = admin.execute("select own_median_30d from public.pub_author_summary").fetchone()
    assert row == (Decimal("12.5"),)
