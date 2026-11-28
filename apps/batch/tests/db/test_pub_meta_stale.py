"""pub_meta.is_stale の判定（マイグレーション 0009。FR-02、NFR-90）。

日次バッチは JST 17:00 に前日を基準日として動く。定刻から 14 時間たっても、その回のぶんの
成功がないときだけ「遅れ」にする。日付が変わってからバッチが動くまでの間は、遅れにしない。
"""

from datetime import date

import psycopg
import pytest

pytestmark = pytest.mark.db

type Admin = psycopg.Connection[tuple[object, ...]]

# ビューと同じ式。いま成功しているはずの、いちばん古い基準日
EXPECTED_BASE = "((now() at time zone 'Asia/Tokyo') - interval '31 hours')::date - 1"


def _insert_success(admin: Admin, base_date_sql: str) -> None:
    """いちばん新しい成功として 1 行入れる（終了時刻を先の時刻にして、ほかの行より後にする）。"""
    admin.execute(
        f"""
        insert into internal.batch_run
          (started_at, finished_at, base_date, mode, status, mask_threshold)
        values (now(), now() + interval '1 day', {base_date_sql}, 'daily', 'success', 5)
        """.encode()
    )


def _is_stale(admin: Admin) -> object:
    row = admin.execute(b"select is_stale from public.pub_meta").fetchone()
    assert row is not None
    return row[0]


def test_not_stale_when_latest_expected_run_succeeded(admin: Admin) -> None:
    _insert_success(admin, EXPECTED_BASE)
    assert _is_stale(admin) is False


def test_not_stale_when_newer_run_succeeded(admin: Admin) -> None:
    _insert_success(admin, f"{EXPECTED_BASE} + 1")
    assert _is_stale(admin) is False


def test_stale_when_expected_run_is_missing(admin: Admin) -> None:
    _insert_success(admin, f"{EXPECTED_BASE} - 1")
    assert _is_stale(admin) is True


def test_stale_when_no_success_at_all(admin: Admin) -> None:
    admin.execute(b"delete from internal.batch_run")
    assert _is_stale(admin) is True
    admin.execute(
        b"""
        insert into internal.batch_run (started_at, base_date, mode, status, mask_threshold)
        values (now(), current_date, 'daily', 'failed', 5)
        """
    )
    assert _is_stale(admin) is True


@pytest.mark.parametrize(
    ("now_jst", "expected_base"),
    [
        # 11/23 17:00 の回（基準日 11/22）が終わる前。
        # 成功しているはずなのは 11/22 の回（基準日 11/21）まで
        ("2026-11-24 00:00", date(2026, 11, 21)),
        ("2026-11-24 06:59", date(2026, 11, 21)),
        # 定刻から 14 時間（11/24 07:00）を過ぎたら、11/23 の回（基準日 11/22）の成功が要る
        ("2026-11-24 07:00", date(2026, 11, 22)),
        ("2026-11-24 17:00", date(2026, 11, 22)),
        ("2026-11-25 06:59", date(2026, 11, 22)),
        ("2026-11-25 07:00", date(2026, 11, 23)),
    ],
)
def test_expected_base_date_follows_schedule(
    admin: Admin, now_jst: str, expected_base: date
) -> None:
    # 式そのものの確認。ビューは now() を使うので、同じ式に時刻を入れて確かめる
    row = admin.execute(
        b"select (%s::timestamp - interval '31 hours')::date - 1", (now_jst,)
    ).fetchone()
    assert row == (expected_base,)


def test_view_uses_the_tested_expression(admin: Admin) -> None:
    row = admin.execute(b"select pg_get_viewdef('public.pub_meta'::regclass, true)").fetchone()
    assert row is not None
    definition = " ".join(str(row[0]).split())
    assert "'31:00:00'::interval" in definition or "'31 hours'::interval" in definition
    assert "'Asia/Tokyo'" in definition
