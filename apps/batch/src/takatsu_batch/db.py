"""データベースへの接続と、実行記録・前回の状態の読み書き（03 §7、ADR 0009）。

psycopg.connect を呼ぶのはここの 1 か所だけ。TLS の設定はキーワードで固定する。
表名は internal. で修飾し、search_path に依存しない。
"""

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Final, Literal

import psycopg
from psycopg import pq
from psycopg.types.json import Jsonb

from takatsu_batch.config import (
    ABANDONED_RUN_HOURS,
    DB_CA_CERT_FILE,
    DB_CONNECT_TIMEOUT_SECONDS,
    DB_SSLMODE,
)
from takatsu_batch.env import DbTarget
from takatsu_batch.log import ErrorKind, Step
from takatsu_batch.models import RunCounts

type Conn = psycopg.Connection[tuple[Any, ...]]
type RunMode = Literal["daily", "backfill"]

CA_CERT_PATH: Final = Path(__file__).resolve().parents[2] / "certs" / DB_CA_CERT_FILE
# require_auth は libpq 16 以上（ADR 0009）。版は psycopg-binary が同梱する libpq で決まる
_REQUIRE_AUTH_MIN_LIBPQ: Final = 160000


def connect_kwargs(target: DbTarget) -> dict[str, Any]:
    """接続のキーワード。ローカルの supabase start だけが TLS なし（ADR 0009）。"""
    kwargs: dict[str, Any] = {
        "prepare_threshold": None,
        "connect_timeout": DB_CONNECT_TIMEOUT_SECONDS,
        "autocommit": False,
    }
    if not target.is_local:
        kwargs["sslmode"] = DB_SSLMODE
        kwargs["sslrootcert"] = str(CA_CERT_PATH)
        # 暗号化は TLS だけにする。環境に Kerberos の資格情報があっても GSS を試さない
        kwargs["gssencmode"] = "disable"
        if pq.version() >= _REQUIRE_AUTH_MIN_LIBPQ:
            kwargs["require_auth"] = "scram-sha-256"
    return kwargs


def connect(target: DbTarget) -> Conn:
    """接続を開く。呼び出し側は with で閉じる。GA4 と WP を待つ間は持たない。"""
    connection: Conn = psycopg.connect(target.url.get_secret_value(), **connect_kwargs(target))
    return connection


@dataclass(frozen=True, slots=True)
class PostRow:
    post_id: int
    title: str
    post_url: str
    author_slug: str
    published_at: datetime
    published_on: date
    modified_at: datetime
    is_ad: bool
    first_seen_on: date


@dataclass(frozen=True, slots=True)
class AuthorRow:
    author_slug: str
    display_name: str
    author_url: str
    first_seen_on: date


@dataclass(frozen=True, slots=True)
class PriorState:
    """前回までの状態。preflight の接続で読む。"""

    last_success_started_at: datetime | None
    posts: dict[int, PostRow]
    authors: dict[str, AuthorRow]
    post_categories: frozenset[tuple[int, int]]
    post_tags: frozenset[tuple[int, int]]
    confirmed_months: frozenset[str]
    referrer_months: frozenset[str]
    city_months: frozenset[str]
    referrer_computed: dict[int, date]


@dataclass(frozen=True, slots=True)
class DeriveInputs:
    """derive の読み出し。article_daily の全期間と、article_period のキー。"""

    article_daily: dict[tuple[int, date], int]
    article_period_keys: frozenset[tuple[int, str]]


def has_success(conn: Conn, base_date: date, started_after: datetime) -> bool:
    """同じ基準日の成功があるか。データが揃う前に始まった実行は数えない（03 §3）。"""
    row = conn.execute(
        """
        select 1 from internal.batch_run
        where base_date = %s and status = 'success' and started_at >= %s
        limit 1
        """,
        (base_date, started_after),
    ).fetchone()
    return row is not None


def close_abandoned_runs(conn: Conn, now: datetime) -> None:
    """強制終了などで running のまま残った行を失敗に直す。工程は分からないので入れない。"""
    conn.execute(
        """
        update internal.batch_run
        set status = 'failed', error_kind = 'unknown', finished_at = %s, updated_at = now()
        where status = 'running' and started_at < %s
        """,
        (now, now - timedelta(hours=ABANDONED_RUN_HOURS)),
    )


def start_run(
    conn: Conn,
    started_at: datetime,
    base_date: date,
    mode: RunMode,
    mask_threshold: int,
    github_run_id: str | None,
) -> int:
    row = conn.execute(
        """
        insert into internal.batch_run
          (started_at, base_date, mode, status, mask_threshold, github_run_id)
        values (%s, %s, %s, 'running', %s, %s)
        returning run_id
        """,
        (started_at, base_date, mode, mask_threshold, github_run_id),
    ).fetchone()
    if row is None:
        raise psycopg.DataError
    run_id: int = row[0]
    return run_id


def finish_run_success(conn: Conn, run_id: int | None, now: datetime, counts: RunCounts) -> None:
    conn.execute(
        """
        update internal.batch_run
        set status = 'success', finished_at = %s, counts = %s, updated_at = now()
        where run_id = %s
        """,
        (now, Jsonb(counts.model_dump()), run_id),
    )


def finish_run_failed(
    conn: Conn, run_id: int, step: Step, kind: ErrorKind, counts: RunCounts
) -> None:
    conn.execute(
        """
        update internal.batch_run
        set status = 'failed', failed_step = %s, error_kind = %s, finished_at = now(),
            counts = %s, updated_at = now()
        where run_id = %s
        """,
        (step, kind, Jsonb(counts.model_dump()), run_id),
    )


def read_prior_state(conn: Conn) -> PriorState:
    last_success = conn.execute(
        "select max(started_at) from internal.batch_run where status = 'success'"
    ).fetchone()
    posts = {
        row[0]: PostRow(*row)
        for row in conn.execute(
            """
            select post_id, title, post_url, author_slug, published_at, published_on,
                   modified_at, is_ad, first_seen_on
            from internal.wp_post
            """
        )
    }
    authors = {
        row[0]: AuthorRow(*row)
        for row in conn.execute(
            "select author_slug, display_name, author_url, first_seen_on from internal.wp_author"
        )
    }
    return PriorState(
        last_success_started_at=None if last_success is None else last_success[0],
        posts=posts,
        authors=authors,
        post_categories=frozenset(
            (row[0], row[1])
            for row in conn.execute("select post_id, category_id from internal.wp_post_category")
        ),
        post_tags=frozenset(
            (row[0], row[1])
            for row in conn.execute("select post_id, tag_id from internal.wp_post_tag")
        ),
        confirmed_months=frozenset(
            row[0]
            for row in conn.execute(
                "select period_id from internal.period where kind = 'month' and is_confirmed"
            )
        ),
        referrer_months=frozenset(
            row[0]
            for row in conn.execute("select distinct period_id from internal.site_month_referrer")
        ),
        city_months=frozenset(
            row[0]
            for row in conn.execute("select distinct period_id from internal.site_month_city")
        ),
        referrer_computed={
            row[0]: row[1]
            for row in conn.execute(
                """
                select post_id, referrer_30d_computed_on from internal.article_summary
                where referrer_30d_computed_on is not null
                """
            )
        },
    )


def read_derive_inputs(conn: Conn) -> DeriveInputs:
    return DeriveInputs(
        article_daily={
            (row[0], row[1]): row[2]
            for row in conn.execute("select post_id, day, pageviews from internal.article_daily")
        },
        article_period_keys=frozenset(
            (row[0], row[1])
            for row in conn.execute("select post_id, period_id from internal.article_period")
        ),
    )
