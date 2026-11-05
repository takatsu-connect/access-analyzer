"""I-DB-01、02、03、15、16 の一部、18: 権限、RLS、_mask 列（07 §4）。"""

import json
import re
from pathlib import Path

import httpx
import psycopg
import pytest
from psycopg import errors, sql

from support.localenv import local_setting

pytestmark = pytest.mark.db

type Admin = psycopg.Connection[tuple[object, ...]]

REPO = Path(__file__).resolve().parents[4]
MIGRATIONS = REPO / "supabase" / "migrations"
CHECKS = REPO / "supabase" / "checks"
SEED = REPO / "supabase" / "seed"
SNAPSHOT = REPO / "tests" / "snapshots" / "pub-columns.json"

BATCH_WRITER_TABLES = {
    "period",
    "wp_author",
    "wp_post",
    "wp_category",
    "wp_tag",
    "wp_post_category",
    "wp_post_tag",
    "site_daily",
    "site_daily_channel",
    "site_daily_device",
    "article_daily",
    "site_period",
    "site_period_breakdown",
    "site_period_heatmap",
    "article_period",
    "article_period_breakdown",
    "author_period_breakdown",
    "site_month_referrer",
    "site_month_city",
    "article_referrer_30d",
    "article_summary",
    "article_milestone",
    "author_summary",
    "batch_run",
    "sns_source_unmapped",
}
# 02 §4 の表にある公開ビュー
PUB_VIEWS = {
    "pub_meta",
    "pub_batch_run",
    "pub_period",
    "pub_author",
    "pub_post",
    "pub_category",
    "pub_tag",
    "pub_post_category",
    "pub_post_tag",
    "pub_site_daily",
    "pub_site_daily_channel",
    "pub_site_daily_device",
    "pub_site_period",
    "pub_site_period_breakdown",
    "pub_site_period_heatmap",
    "pub_site_period_freshness",
    "pub_site_month_referrer",
    "pub_site_month_city",
    "pub_article_daily",
    "pub_article_cumulative",
    "pub_article_period",
    "pub_article_period_breakdown",
    "pub_article_referrer_30d",
    "pub_article_summary",
    "pub_article_milestone",
    "pub_author_period",
    "pub_author_period_breakdown",
    "pub_author_category_period",
    "pub_author_summary",
    "pub_category_period",
    "pub_tag_period",
    "pub_posting_monthly",
    "pub_posting_period",
    "pub_benchmark_curve",
}
# Supabase が管理し、anon / authenticated に基盤が権限を与えているスキーマ（ローカルの実測）。
# 新しいスキーマが増えたらこの一致で気づく。除外の可否は依頼者と security-auditor の判断待ち。
MANAGED_WITH_ANON_USAGE = {
    "auth",
    "extensions",
    "graphql",
    "graphql_public",
    "realtime",
    "storage",
    "supabase_functions",
}
DEFAULT_USAGE = {"pg_catalog", "information_schema"}


def _rows(admin: Admin, query: str) -> list[tuple[object, ...]]:
    return admin.execute(query.encode()).fetchall()


def _check_body(name: str) -> str:
    return (CHECKS / f"{name}.sql").read_text(encoding="utf-8")


def test_i_db_01_anon_table_grants_are_pub_select_only(admin: Admin) -> None:
    grants = _rows(
        admin,
        """
        select grantee, table_schema, table_name, privilege_type
        from information_schema.role_table_grants
        where grantee in ('anon', 'authenticated', 'PUBLIC')
          and table_schema in ('public', 'internal')
        """,
    )
    expected = {("anon", "public", view, "SELECT") for view in PUB_VIEWS}
    assert set(grants) == expected


def test_i_db_01_no_routine_or_sequence_grants(admin: Admin) -> None:
    assert not _rows(
        admin,
        """
        select grantee, routine_schema, routine_name
        from information_schema.routine_privileges
        where grantee in ('anon', 'authenticated', 'PUBLIC')
          and routine_schema in ('public', 'internal')
        """,
    )
    assert not _rows(
        admin,
        """
        select grantee, object_schema, object_name
        from information_schema.role_usage_grants
        where grantee in ('anon', 'authenticated', 'PUBLIC')
          and object_schema in ('public', 'internal')
        """,
    )


@pytest.mark.parametrize("table", sorted(BATCH_WRITER_TABLES))
def test_i_db_01_anon_cannot_read_internal_tables(admin: Admin, table: str) -> None:
    admin.execute("set local role anon")
    query = sql.SQL("select * from internal.{}").format(sql.Identifier(table))
    with pytest.raises(errors.InsufficientPrivilege):
        admin.execute(query)


@pytest.mark.parametrize("view", ["article_cumulative", "benchmark_curve"])
def test_i_db_01_anon_cannot_read_internal_views(admin: Admin, view: str) -> None:
    admin.execute("set local role anon")
    with pytest.raises(errors.InsufficientPrivilege):
        admin.execute(sql.SQL("select * from internal.{}").format(sql.Identifier(view)))


def test_i_db_01_service_role_has_no_internal_usage(admin: Admin) -> None:
    assert _rows(admin, "select has_schema_privilege('service_role', 'internal', 'USAGE')") == [
        (False,)
    ]


def test_i_db_01_pub_views_have_only_owner_and_anon_select(admin: Admin) -> None:
    rows = _rows(
        admin,
        """
        select c.relname, acl.grantee::regrole::text, acl.privilege_type
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        cross join lateral aclexplode(c.relacl) as acl
        where n.nspname = 'public' and acl.grantee <> c.relowner
        """,
    )
    assert set(rows) == {(view, "anon", "SELECT") for view in PUB_VIEWS}


def test_i_db_01_default_privileges_only_for_owner(admin: Admin) -> None:
    rows = _rows(
        admin,
        """
        select n.nspname, d.defaclobjtype::text, acl.grantee::regrole::text
        from pg_default_acl d
        join pg_namespace n on n.oid = d.defaclnamespace
        cross join lateral aclexplode(d.defaclacl) as acl
        where d.defaclrole = 'postgres'::regrole
          and n.nspname in ('public', 'internal')
          and acl.grantee <> d.defaclrole
        """,
    )
    assert rows == []


@pytest.mark.parametrize("view", sorted(PUB_VIEWS))
def test_i_db_01_anon_can_select_every_pub_view(admin: Admin, view: str) -> None:
    admin.execute("set local role anon")
    admin.execute(sql.SQL("select * from public.{} limit 1").format(sql.Identifier(view)))


@pytest.mark.parametrize("role", ["anon", "authenticated", "service_role", "batch_writer"])
@pytest.mark.parametrize("privilege", ["INSERT", "UPDATE", "DELETE", "TRUNCATE"])
def test_i_db_01_no_role_can_write_any_pub_view(admin: Admin, role: str, privilege: str) -> None:
    for view in sorted(PUB_VIEWS):
        allowed = admin.execute(
            "select has_table_privilege(%s, %s::regclass, %s)",
            (role, f"public.{view}", privilege),
        ).fetchone()
        assert allowed == (False,), view


@pytest.mark.parametrize(
    "statement",
    [
        "select * from public.pub_site_daily",
        "insert into public.pub_site_daily (day, pageviews, sessions) values ('2026-01-01', 1, 1)",
        "update public.pub_site_daily set pageviews = 0",
        "delete from public.pub_site_daily",
        "insert into public.pub_tag (tag_id, name) values (1, 'x')",
        "delete from public.pub_author",
    ],
)
def test_i_db_01_service_role_is_denied_on_pub_views(admin: Admin, statement: str) -> None:
    # 自動更新可能なビューを通じて内部表へ書き込めないことを、実行して確かめる
    admin.execute("set local role service_role")
    with pytest.raises(errors.InsufficientPrivilege):
        admin.execute(statement.encode())


def test_i_db_02_rls_enabled_on_every_internal_table(admin: Admin) -> None:
    rows = _rows(
        admin, "select tablename, rowsecurity from pg_tables where schemaname = 'internal'"
    )
    assert {name for name, _ in rows} == BATCH_WRITER_TABLES
    assert all(enabled for _, enabled in rows)
    assert not _rows(admin, "select tablename from pg_tables where schemaname = 'public'")


@pytest.mark.parametrize(
    "statement",
    [
        "insert into public.pub_site_daily (day, pageviews, sessions) values ('2026-01-01', 1, 1)",
        "update public.pub_site_daily set pageviews = 0",
        "delete from public.pub_site_daily",
    ],
)
def test_i_db_02_anon_cannot_write_through_views(admin: Admin, statement: str) -> None:
    admin.execute("set local role anon")
    with pytest.raises(errors.InsufficientPrivilege):
        admin.execute(statement.encode())


def test_i_db_03_no_mask_columns_and_views_match_design(admin: Admin) -> None:
    rows = _rows(
        admin,
        """
        select table_name, column_name from information_schema.columns
        where table_schema = 'public' and table_name like 'pub\\_%'
        """,
    )
    assert {str(table) for table, _ in rows} == PUB_VIEWS
    columns = {str(column) for _, column in rows}
    assert not [column for column in columns if "_mask" in column]
    assert not columns & {"author_count", "share_count"}


def _actual_columns(admin: Admin) -> dict[str, list[dict[str, str]]]:
    rows = _rows(
        admin,
        """
        select table_name, column_name, data_type
        from information_schema.columns
        where table_schema = 'public' and table_name like 'pub\\_%'
        order by table_name, ordinal_position
        """,
    )
    actual: dict[str, list[dict[str, str]]] = {}
    for view, column, data_type in rows:
        actual.setdefault(str(view), []).append({"column": str(column), "type": str(data_type)})
    return actual


def _snapshot() -> dict[str, list[dict[str, str]]]:
    loaded: dict[str, list[dict[str, str]]] = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    return loaded


def test_i_db_16_columns_match_snapshot(admin: Admin) -> None:
    # 差分があれば、スナップショットの更新と NFR-39 の手順を PR で示す（ADR と security-auditor）
    assert _actual_columns(admin) == _snapshot()


def test_i_db_16_snapshot_has_no_forbidden_columns() -> None:
    snapshot = _snapshot()
    assert set(snapshot) == PUB_VIEWS
    columns = {item["column"] for items in snapshot.values() for item in items}
    assert not [column for column in columns if "_mask" in column]
    assert not columns & {"author_count", "share_count", "age_days_raw", "modified_at", "counts"}


@pytest.mark.parametrize(
    "statement",
    [
        # 内部の列を足す
        """
        create or replace view public.pub_tag as
        select tag_id, name, updated_at from internal.wp_tag
        """,
        # 型を変える
        """
        drop view public.pub_tag;
        create view public.pub_tag as select tag_id::bigint as tag_id, name from internal.wp_tag
        """,
        # 新しいビューを足す
        "create view public.pub_extra as select tag_id from internal.wp_tag",
    ],
)
def test_i_db_16_detects_changes(admin: Admin, statement: str) -> None:
    admin.execute(statement.encode())
    assert _actual_columns(admin) != _snapshot()


def test_i_db_15_schema_usage(admin: Admin) -> None:
    rows = _rows(
        admin,
        """
        select r.role_name, n.nspname
        from (values ('anon'), ('authenticated')) as r (role_name)
        cross join pg_namespace n
        where has_schema_privilege(r.role_name, n.oid, 'USAGE')
        """,
    )
    for role in ("anon", "authenticated"):
        schemas = {str(schema) for name, schema in rows if name == role}
        assert schemas == MANAGED_WITH_ANON_USAGE | DEFAULT_USAGE | {"public"}


def test_i_db_15_counts_check_rejects_strings(admin: Admin) -> None:
    with pytest.raises(errors.CheckViolation):
        admin.execute(
            """
            insert into internal.batch_run
              (started_at, base_date, mode, status, mask_threshold, counts)
            values (now(), '2026-01-01', 'daily', 'running', 5, '{"rows_written": "x"}')
            """
        )


@pytest.mark.parametrize(
    "counts",
    ['{"unknown_key": 1}', "[1]", '{"rows_written": [1]}', '{"rows_written": {"a": 1}}'],
)
def test_i_db_15_counts_check_rejects_other_shapes(admin: Admin, counts: str) -> None:
    with pytest.raises(errors.CheckViolation):
        admin.execute(
            """
            insert into internal.batch_run
              (started_at, base_date, mode, status, mask_threshold, counts)
            values (now(), '2026-01-01', 'daily', 'running', 5, %s::jsonb)
            """,
            (counts,),
        )


@pytest.mark.parametrize("name", ["anon_privileges", "batch_writer_privileges"])
def test_check_files_return_no_violation(admin: Admin, name: str) -> None:
    assert _rows(admin, _check_body(name)) == []


@pytest.mark.parametrize(
    ("statement", "expected"),
    [
        ("grant insert on public.pub_site_daily to service_role", "relation grant: service_role"),
        ("grant select on public.pub_site_daily to authenticated", "table grant: authenticated"),
        (
            "alter default privileges for role postgres in schema public "
            "grant select on tables to service_role",
            "default privilege: service_role",
        ),
        ("grant usage on schema internal to anon", "schema usage: anon internal"),
        ("grant create on schema public to anon", "schema create: anon public"),
        ("grant create on schema public to authenticated", "schema create: authenticated public"),
        (
            "grant usage on schema internal to service_role",
            "service_role on internal: schema USAGE",
        ),
        (
            "grant select on internal.wp_post to service_role",
            "effective privilege: service_role internal.wp_post SELECT",
        ),
        (
            "grant select (day) on public.pub_site_daily to authenticated",
            "column grant: authenticated public.pub_site_daily.day",
        ),
        (
            "grant update (title) on internal.wp_post to anon",
            "column grant: anon internal.wp_post.title",
        ),
    ],
)
def test_check_detects_regression(admin: Admin, statement: str, expected: str) -> None:
    # 検査そのものが働くことを、権限を広げて確かめる（変更はロールバックする）
    admin.execute(statement.encode())
    violations = [str(row[0]) for row in _rows(admin, _check_body("anon_privileges"))]
    assert any(violation.startswith(expected) for violation in violations), violations


@pytest.mark.parametrize(
    ("statement", "expected"),
    [
        ("grant truncate on internal.site_daily to batch_writer", "extra table grant: internal"),
        ("grant delete on internal.batch_run to batch_writer", "extra table grant: internal"),
        ("grant select on public.pub_post to batch_writer", "extra table grant: public"),
        ("grant select on internal.benchmark_curve to batch_writer", "extra table grant: internal"),
        ("revoke select on internal.wp_post from batch_writer", "missing table grant: internal"),
        (
            "grant select (title) on public.pub_post to batch_writer",
            "column grant: public.pub_post.title",
        ),
        ("grant select on public.pub_post to public", "effective privilege: public.pub_post"),
        ("grant create on schema internal to batch_writer", "schema create: internal"),
        ("grant usage on schema storage to batch_writer", "schema usage: storage"),
        ("grant anon to batch_writer", "role membership: anon"),
        ("alter role batch_writer createdb", "role attribute: batch_writer"),
        ("alter role batch_writer connection limit 3", "role attribute: batch_writer"),
        (
            "create function internal.extra() returns integer language sql as 'select 1';"
            "grant execute on function internal.extra() to batch_writer",
            "routine grant: internal.extra",
        ),
        (
            "create sequence internal.extra_seq;"
            "grant usage on sequence internal.extra_seq to batch_writer",
            "usage grant: internal.extra_seq",
        ),
    ],
)
def test_batch_writer_check_detects_regression(admin: Admin, statement: str, expected: str) -> None:
    admin.execute(statement.encode())
    violations = [str(row[0]) for row in _rows(admin, _check_body("batch_writer_privileges"))]
    assert any(violation.startswith(expected) for violation in violations), violations


def _normalize(text: str) -> str:
    lines = [line for line in text.splitlines() if not line.lstrip().startswith("--")]
    return re.sub(r"\s+", " ", " ".join(lines)).strip().removesuffix(";").strip()


@pytest.mark.parametrize("name", ["anon_privileges", "batch_writer_privileges"])
def test_i_db_18_10_migration_check_matches_file(name: str) -> None:
    migration = (MIGRATIONS / "0005_public_views.sql").read_text(encoding="utf-8")
    match = re.search(rf"-- BEGIN CHECK {name}\n(.*?)-- END CHECK {name}", migration, re.DOTALL)
    assert match is not None
    assert _normalize(match.group(1)) == _normalize(_check_body(name))


def test_i_db_18_1_grants_match_allow_list(admin: Admin) -> None:
    rows = _rows(
        admin,
        """
        select table_schema, table_name, privilege_type
        from information_schema.role_table_grants where grantee = 'batch_writer'
        """,
    )
    expected = {
        ("internal", table, privilege)
        for table in BATCH_WRITER_TABLES
        for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE")
        if not (table == "batch_run" and privilege == "DELETE")
    }
    assert set(rows) == expected


def test_i_db_18_2_no_read_on_views(admin: Admin) -> None:
    targets = ["internal.article_cumulative", "internal.benchmark_curve"] + [
        f"public.{view}" for view in sorted(PUB_VIEWS)
    ]
    for target in targets:
        allowed = admin.execute(
            "select has_table_privilege('batch_writer', %s::regclass, 'SELECT')", (target,)
        ).fetchone()
        assert allowed == (False,), target


def test_i_db_18_3_policies_and_role_attributes(admin: Admin) -> None:
    policies = _rows(
        admin, "select schemaname, tablename, policyname, roles::text from pg_policies"
    )
    ours = [row for row in policies if row[0] in ("internal", "public")]
    assert {row[1] for row in ours} == BATCH_WRITER_TABLES
    assert {row[2] for row in ours} == {"batch_writer_all"}
    assert {row[3] for row in ours} == {"{batch_writer}"}

    role = _rows(
        admin,
        """
        select rolbypassrls, rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolinherit,
               rolconnlimit, rolconfig
        from pg_roles where rolname = 'batch_writer'
        """,
    )
    assert role == [(False, False, False, False, False, False, 2, ["statement_timeout=120s"])]


def test_i_db_18_3_nologin_after_migration(admin: Admin) -> None:
    # batch_writer_url の fixture を使う test_i_db_18_as_batch_writer より前に定義しておく。
    # fixture は session の終わりに nologin へ戻す。
    can_login = _rows(admin, "select rolcanlogin from pg_roles where rolname = 'batch_writer'")
    assert can_login == [(False,)]


def test_i_db_18_5_no_credentials_in_migrations_and_seed() -> None:
    for path in [*MIGRATIONS.glob("*.sql"), *SEED.rglob("*.sql")]:
        assert "password" not in path.read_text(encoding="utf-8").lower(), path.name


def test_i_db_18_7_schema_privileges(admin: Admin) -> None:
    rows = _rows(
        admin,
        """
        select n.nspname,
               has_schema_privilege('batch_writer', n.oid, 'USAGE'),
               has_schema_privilege('batch_writer', n.oid, 'CREATE')
        from pg_namespace n
        """,
    )
    assert not [name for name, _, can_create in rows if can_create]
    assert {name for name, can_use, _ in rows if can_use} == DEFAULT_USAGE | {"internal", "public"}
    acl = _rows(
        admin,
        """
        select acl.privilege_type, acl.grantee::regrole::text
        from pg_namespace n cross join lateral aclexplode(n.nspacl) as acl
        where n.nspname = 'public' and acl.grantee in (0, 'batch_writer'::regrole)
        """,
    )
    # public の USAGE は PUBLIC 経由だけ（0 は PUBLIC）
    assert acl == [("USAGE", "-")]


def test_i_db_18_8_9_routines_sequences_membership(admin: Admin) -> None:
    assert _rows(
        admin,
        """
        select routine_schema, routine_name from information_schema.routine_privileges
        where grantee = 'batch_writer'
        """,
    ) == [("internal", "counts_is_numeric")]
    assert not _rows(
        admin,
        """
        select object_name from information_schema.role_usage_grants
        where grantee = 'batch_writer'
        """,
    )
    assert not _rows(admin, "select 1 from pg_auth_members where member = 'batch_writer'::regrole")


def test_i_db_18_as_batch_writer(batch_writer_url: str, admin_url: str) -> None:
    """(2) 読めない、(4) 書ける、(6) DDL が拒否される。変更はすべてロールバックする。"""
    with psycopg.connect(batch_writer_url, autocommit=False) as conn:
        for statement in (
            "select * from public.pub_post",
            "select * from internal.article_cumulative",
            "select * from internal.benchmark_curve",
        ):
            with pytest.raises(errors.InsufficientPrivilege), conn.transaction():
                conn.execute(statement.encode())

        # (4) upsert、delete、batch_run の insert（V-4: シーケンスの grant なしで動くか）
        with conn.transaction(force_rollback=True):
            conn.execute(
                """
                insert into internal.site_daily (day, pageviews, sessions)
                values ('2026-01-01', 1, 1)
                on conflict (day) do update set pageviews = excluded.pageviews
                """
            )
            conn.execute(
                """
                insert into internal.site_daily (day, pageviews, sessions)
                values ('2026-01-01', 2, 1)
                on conflict (day) do update set pageviews = excluded.pageviews
                """
            )
            conn.execute("delete from internal.site_daily where day = '2026-01-01'")
            run = conn.execute(
                """
                insert into internal.batch_run
                  (started_at, base_date, mode, status, mask_threshold, counts)
                values (now(), '2026-01-01', 'daily', 'running', 5, '{"rows_written": 3}')
                returning run_id
                """
            ).fetchone()
            assert run is not None

        with pytest.raises(errors.InsufficientPrivilege), conn.transaction():
            conn.execute("delete from internal.batch_run")

        # (6)
        for statement in (
            "create table internal.x (id integer)",
            "create table public.x (id integer)",
            "alter table internal.site_daily add column x integer",
            "truncate internal.site_daily",
        ):
            with pytest.raises(errors.InsufficientPrivilege), conn.transaction():
                conn.execute(statement.encode())


def test_i_db_01_postgrest_layer() -> None:
    """anon キーで PostgREST から読む。pub_ だけが見え、internal には届かない。"""
    url = local_setting("SUPABASE_LOCAL_API_URL")
    key = local_setting("SUPABASE_LOCAL_ANON_KEY")
    if not url or not key:
        pytest.skip("SUPABASE_LOCAL_API_URL / SUPABASE_LOCAL_ANON_KEY がない")
    assert httpx.URL(url).host in {"localhost", "127.0.0.1"}
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    with httpx.Client(base_url=f"{url}/rest/v1", headers=headers, timeout=30) as client:
        assert client.get("/pub_period").status_code == 200
        assert client.get("/wp_post").status_code == 404
        schema_denied = client.get("/wp_post", headers={"Accept-Profile": "internal"})
        assert schema_denied.status_code == 406
        insert = client.post(
            "/pub_site_daily", json={"day": "2026-01-01", "pageviews": 1, "sessions": 1}
        )
        assert insert.status_code in {401, 403}
