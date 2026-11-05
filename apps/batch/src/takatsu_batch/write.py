"""Supabase への書き込み（03 §7、ADR 0009）。全体を 1 トランザクションで行う。

列名とキーは下の固定の定義から組み立て、値はすべてパラメータで渡す。
行の内容をログに出さない。
"""

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from itertools import batched
from typing import Any, Final

from psycopg import sql

from takatsu_batch.config import DB_WRITE_CHUNK_ROWS
from takatsu_batch.db import Conn
from takatsu_batch.derive import DbRow, DeriveOutput

_SCHEMA: Final = "internal"


@dataclass(frozen=True, slots=True)
class TableSpec:
    name: str
    keys: tuple[str, ...]
    values: tuple[str, ...] = ()
    # on conflict で更新しない列（first_seen_on など初回の値を保つもの）
    keep_on_conflict: tuple[str, ...] = ()

    @property
    def columns(self) -> tuple[str, ...]:
        return (*self.keys, *self.values)


PERIOD: Final = TableSpec(
    "period", ("period_id",), ("kind", "start_date", "end_date", "base_date", "is_confirmed")
)
WP_AUTHOR: Final = TableSpec(
    "wp_author", ("author_slug",), ("display_name", "author_url", "first_seen_on")
)
WP_CATEGORY: Final = TableSpec("wp_category", ("category_id",), ("name", "parent_id", "path"))
WP_TAG: Final = TableSpec("wp_tag", ("tag_id",), ("name",))
WP_POST: Final = TableSpec(
    "wp_post",
    ("post_id",),
    (
        "title",
        "post_url",
        "author_slug",
        "published_at",
        "published_on",
        "modified_at",
        "is_ad",
        "first_seen_on",
    ),
)
WP_POST_CATEGORY: Final = TableSpec("wp_post_category", ("post_id", "category_id"))
WP_POST_TAG: Final = TableSpec("wp_post_tag", ("post_id", "tag_id"))
SITE_DAILY: Final = TableSpec("site_daily", ("day",), ("pageviews", "sessions"))
SITE_DAILY_CHANNEL: Final = TableSpec(
    "site_daily_channel", ("day", "channel"), ("sessions", "sessions_mask")
)
SITE_DAILY_DEVICE: Final = TableSpec(
    "site_daily_device",
    ("day", "device"),
    ("pageviews", "pageviews_mask", "sessions", "sessions_mask"),
)
ARTICLE_DAILY: Final = TableSpec("article_daily", ("post_id", "day"), ("pageviews",))
SITE_PERIOD: Final = TableSpec(
    "site_period", ("period_id",), ("engagement_seconds", "active_users", "active_users_mask")
)
SITE_PERIOD_BREAKDOWN: Final = TableSpec(
    "site_period_breakdown", ("period_id", "axis", "bucket"), ("value", "value_mask")
)
SITE_PERIOD_HEATMAP: Final = TableSpec(
    "site_period_heatmap", ("period_id", "dow", "hour"), ("pageviews", "pageviews_mask")
)
ARTICLE_PERIOD: Final = TableSpec(
    "article_period",
    ("post_id", "period_id"),
    (
        "pageviews",
        "landing_sessions",
        "landing_sessions_mask",
        "scroll_count",
        "scroll_count_mask",
        "engagement_seconds",
        "engagement_seconds_mask",
    ),
)
ARTICLE_PERIOD_BREAKDOWN: Final = TableSpec(
    "article_period_breakdown",
    ("post_id", "period_id", "axis", "bucket"),
    ("sessions", "sessions_mask"),
)
AUTHOR_PERIOD_BREAKDOWN: Final = TableSpec(
    "author_period_breakdown",
    ("author_slug", "period_id", "axis", "bucket"),
    ("sessions", "sessions_mask"),
)
SITE_MONTH_REFERRER: Final = TableSpec(
    "site_month_referrer", ("period_id", "rank"), ("source_domain", "sessions")
)
SITE_MONTH_CITY: Final = TableSpec(
    "site_month_city", ("period_id", "rank"), ("country", "region", "city", "sessions")
)
ARTICLE_REFERRER_30D: Final = TableSpec(
    "article_referrer_30d", ("post_id", "rank"), ("source_domain", "sessions", "computed_on")
)
ARTICLE_SUMMARY: Final = TableSpec(
    "article_summary",
    ("post_id",),
    (
        "base_date",
        "age_days",
        "freshness",
        "pv_7d",
        "pv_30d",
        "pv_total",
        "is_recent_hot",
        "is_revival",
        "is_evergreen_365",
        "referrer_30d_computed_on",
    ),
)
ARTICLE_MILESTONE: Final = TableSpec("article_milestone", ("post_id", "milestone"), ("reached_on",))
AUTHOR_SUMMARY: Final = TableSpec(
    "author_summary", ("author_slug",), ("base_date", "own_median_30d", "eligible_count")
)
SNS_SOURCE_UNMAPPED: Final = TableSpec(
    "sns_source_unmapped",
    ("source",),
    ("first_seen_on", "last_seen_on", "last_sessions"),
    keep_on_conflict=("first_seen_on",),
)
BATCH_WRITABLE_TABLES: Final[tuple[TableSpec, ...]] = (
    PERIOD,
    WP_AUTHOR,
    WP_CATEGORY,
    WP_TAG,
    WP_POST,
    WP_POST_CATEGORY,
    WP_POST_TAG,
    SITE_DAILY,
    SITE_DAILY_CHANNEL,
    SITE_DAILY_DEVICE,
    ARTICLE_DAILY,
    SITE_PERIOD,
    SITE_PERIOD_BREAKDOWN,
    SITE_PERIOD_HEATMAP,
    ARTICLE_PERIOD,
    ARTICLE_PERIOD_BREAKDOWN,
    AUTHOR_PERIOD_BREAKDOWN,
    SITE_MONTH_REFERRER,
    SITE_MONTH_CITY,
    ARTICLE_REFERRER_30D,
    ARTICLE_SUMMARY,
    ARTICLE_MILESTONE,
    AUTHOR_SUMMARY,
    SNS_SOURCE_UNMAPPED,
)


def _table(spec: TableSpec) -> sql.Composable:
    return sql.Identifier(_SCHEMA, spec.name)


def _names(names: Iterable[str]) -> sql.Composable:
    return sql.SQL(", ").join(sql.Identifier(name) for name in names)


def upsert_statement(spec: TableSpec) -> sql.Composed:
    updates = [name for name in spec.values if name not in spec.keep_on_conflict]
    conflict: sql.Composable
    if updates:
        conflict = sql.SQL("do update set {}, updated_at = now()").format(
            sql.SQL(", ").join(
                sql.SQL("{name} = excluded.{name}").format(name=sql.Identifier(name))
                for name in updates
            )
        )
    else:
        conflict = sql.SQL("do nothing")
    return sql.SQL(
        "insert into {table} ({columns}) values ({placeholders}) on conflict ({keys}) {conflict}"
    ).format(
        table=_table(spec),
        columns=_names(spec.columns),
        placeholders=sql.SQL(", ").join(sql.Placeholder() for _ in spec.columns),
        keys=_names(spec.keys),
        conflict=conflict,
    )


class _Writer:
    def __init__(self, conn: Conn) -> None:
        self._conn = conn
        self.rows_written = 0

    def upsert(self, spec: TableSpec, rows: Sequence[DbRow]) -> None:
        """1,000 行ずつ流す（03 §7）。"""
        statement = upsert_statement(spec)
        with self._conn.cursor() as cursor:
            for chunk in batched(rows, DB_WRITE_CHUNK_ROWS, strict=False):
                cursor.executemany(statement, chunk)
        self.rows_written += len(rows)

    def _existing_keys(
        self, spec: TableSpec, scope_column: str | None, scope_values: Sequence[Any] | None
    ) -> set[tuple[Any, ...]]:
        statement = sql.SQL("select {keys} from {table}").format(
            keys=_names(spec.keys), table=_table(spec)
        )
        params: tuple[Any, ...] = ()
        if scope_column is not None:
            statement = sql.SQL("{base} where {column} = any(%s)").format(
                base=statement, column=sql.Identifier(scope_column)
            )
            params = (list(scope_values or ()),)
        return {tuple(row) for row in self._conn.execute(statement, params)}

    def delete_stale(
        self,
        spec: TableSpec,
        keep: Iterable[tuple[Any, ...]],
        *,
        scope_column: str | None = None,
        scope_values: Sequence[Any] | None = None,
    ) -> int:
        """今回のキー集合にない行を消す（03 §7）。truncate は使わない。"""
        stale = self._existing_keys(spec, scope_column, scope_values) - set(keep)
        if not stale:
            return 0
        if len(spec.keys) == 1:
            # 1 文で消す。wp_category の自己参照があっても文の終わりで整合する
            self._conn.execute(
                sql.SQL("delete from {table} where {key} = any(%s)").format(
                    table=_table(spec), key=sql.Identifier(spec.keys[0])
                ),
                ([key[0] for key in stale],),
            )
        else:
            condition = sql.SQL(" and ").join(
                sql.SQL("{name} = %s").format(name=sql.Identifier(name)) for name in spec.keys
            )
            statement = sql.SQL("delete from {table} where {condition}").format(
                table=_table(spec), condition=condition
            )
            with self._conn.cursor() as cursor:
                for chunk in batched(sorted(stale), DB_WRITE_CHUNK_ROWS, strict=False):
                    cursor.executemany(statement, chunk)
        self.rows_written += len(stale)
        return len(stale)


def _keys(spec: TableSpec, rows: Iterable[DbRow]) -> set[tuple[Any, ...]]:
    size = len(spec.keys)
    return {tuple(row[:size]) for row in rows}


@dataclass(frozen=True, slots=True)
class WriteResult:
    rows_written: int
    posts_deleted: int


def _write_wp(writer: _Writer, output: DeriveOutput) -> int:
    wp = output.wp
    writer.upsert(
        WP_AUTHOR,
        [
            (row.author_slug, row.display_name, row.author_url, row.first_seen_on)
            for row in wp.authors.values()
        ],
    )
    writer.upsert(
        WP_CATEGORY,
        [(row.category_id, row.name, row.parent_id, row.path) for row in wp.categories],
    )
    writer.upsert(WP_TAG, list(wp.tags))
    writer.upsert(
        WP_POST,
        [
            (
                row.post_id,
                row.title,
                row.post_url,
                row.author_slug,
                row.published_at,
                row.published_on,
                row.modified_at,
                row.is_ad,
                row.first_seen_on,
            )
            for row in wp.changed_posts
        ],
    )
    # 記事を消す前に、残る記事の分類を揃える。消す記事の行は cascade で消える
    posts_deleted = writer.delete_stale(WP_POST, {(post_id,) for post_id in wp.posts})
    writer.delete_stale(WP_POST_CATEGORY, wp.post_categories)
    writer.delete_stale(WP_POST_TAG, wp.post_tags)
    writer.upsert(WP_POST_CATEGORY, sorted(wp.post_categories))
    writer.upsert(WP_POST_TAG, sorted(wp.post_tags))
    writer.delete_stale(WP_CATEGORY, {(row.category_id,) for row in wp.categories})
    writer.delete_stale(WP_TAG, {(tag_id,) for tag_id, _ in wp.tags})
    writer.delete_stale(WP_AUTHOR, {(slug,) for slug in wp.authors})
    return posts_deleted


def _write_ga4(writer: _Writer, output: DeriveOutput) -> None:
    writer.upsert(SITE_DAILY, output.site_daily)
    writer.upsert(SITE_DAILY_CHANNEL, output.site_daily_channel)
    writer.upsert(SITE_DAILY_DEVICE, output.site_daily_device)
    writer.upsert(ARTICLE_DAILY, output.article_daily)
    writer.delete_stale(
        ARTICLE_DAILY,
        _keys(ARTICLE_DAILY, output.article_daily),
        scope_column="day",
        scope_values=output.article_daily_scope_days,
    )
    refetched = output.refetched_period_ids
    for spec, rows in (
        (SITE_PERIOD, output.site_period),
        (SITE_PERIOD_BREAKDOWN, output.site_period_breakdown),
        (SITE_PERIOD_HEATMAP, output.site_period_heatmap),
        (ARTICLE_PERIOD, output.article_period),
        (ARTICLE_PERIOD_BREAKDOWN, output.article_period_breakdown),
        (AUTHOR_PERIOD_BREAKDOWN, output.author_period_breakdown),
    ):
        writer.upsert(spec, rows)
        writer.delete_stale(
            spec, _keys(spec, rows), scope_column="period_id", scope_values=refetched
        )
    for spec, rows, column, scope in (
        (
            SITE_MONTH_REFERRER,
            output.site_month_referrer,
            "period_id",
            output.referrer_scope_months,
        ),
        (SITE_MONTH_CITY, output.site_month_city, "period_id", output.city_scope_months),
        (
            ARTICLE_REFERRER_30D,
            output.article_referrer_30d,
            "post_id",
            output.referrer_scope_posts,
        ),
    ):
        writer.upsert(spec, rows)
        writer.delete_stale(spec, _keys(spec, rows), scope_column=column, scope_values=scope)


def _write_derived(writer: _Writer, output: DeriveOutput) -> None:
    for spec, rows in (
        (ARTICLE_SUMMARY, output.article_summary),
        (ARTICLE_MILESTONE, output.article_milestone),
        (AUTHOR_SUMMARY, output.author_summary),
    ):
        writer.upsert(spec, rows)
        writer.delete_stale(spec, _keys(spec, rows))
    writer.upsert(SNS_SOURCE_UNMAPPED, output.sns_source_unmapped)


def write_all(conn: Conn, output: DeriveOutput) -> WriteResult:
    """工程 6。例外で抜ければロールバックされ、前回の成功時の状態が残る。"""
    writer = _Writer(conn)
    with conn.transaction():
        conn.execute("set local statement_timeout = '120s'")
        writer.upsert(PERIOD, output.period_rows)
        posts_deleted = _write_wp(writer, output)
        _write_ga4(writer, output)
        _write_derived(writer, output)
    return WriteResult(rows_written=writer.rows_written, posts_deleted=posts_deleted)
