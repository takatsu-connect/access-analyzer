"""I-B-11: 未処理例外でも、工程と種別のほかは何も出さない（03 §14、NFR-44）。

本物のエントリ（python -m takatsu_batch と同じ __main__）を子プロセスで動かす。外部は
tests/support/entry_harness.py が偽物に替え、壊し方を 1 つだけ起こす。
書き込み先はローカルの Supabase。
"""

import json
import os
import re
import subprocess
import sys
from pathlib import Path

import pytest
from psycopg.conninfo import conninfo_to_dict

from integration.conftest import Query
from support import batch_scenario as scenario

pytestmark = pytest.mark.db

TESTS = Path(__file__).resolve().parents[1]
SRC = TESTS.parent / "src"
HARNESS = TESTS / "support" / "entry_harness.py"
FORBIDDEN = (
    "postgresql://",
    "pooler",
    "batch_writer",
    "hunter2",
    "Failing row",
    "Key (",
    "https://",
    "properties/",
    "eyJ",
    "Traceback",
    'File "',
)
LONG_DIGITS = re.compile(r"\d{6,}")
# 子プロセスに引き継がない環境変数。gRPC の出力の抑止はエントリが自分で設定する（03 §14 の 4）
DROPPED_ENV = {"GRPC_VERBOSITY", "GOOGLE_APPLICATION_CREDENTIALS", "GITHUB_RUN_ID"}


def _as_url(conninfo: str, **overrides: str) -> str:
    """env.py が受ける URL の形にする（03 §16）。ローカルのパスワードは URL に安全な文字だけ。"""
    parts = {**conninfo_to_dict(conninfo), **overrides}
    return (
        f"postgresql://{parts['user']}:{parts['password']}"
        f"@{parts['host']}:{parts['port']}/{parts['dbname']}"
    )


def _run(name: str, db_url: str) -> subprocess.CompletedProcess[str]:
    env = {
        key: value
        for key, value in os.environ.items()
        if key not in DROPPED_ENV and not key.startswith("PG")
    }
    env |= {
        "PYTHONPATH": os.pathsep.join([str(SRC), str(TESTS)]),
        "PYTHONIOENCODING": "utf-8",
        "SUPABASE_BATCH_DB_URL": db_url,
        "GA4_PROPERTY_ID": scenario.PROPERTY_ID,
        "VERCEL_DEPLOY_HOOK_URL": scenario.HOOK_URL,
        "BASE_DATE": scenario.BASE_DATE.isoformat(),
    }
    return subprocess.run(
        [sys.executable, str(HARNESS), name],
        env=env,
        capture_output=True,
        text=True,
        timeout=180,
        check=False,
    )


def _assert_clean(result: subprocess.CompletedProcess[str]) -> None:
    assert result.stderr == ""
    for word in FORBIDDEN:
        assert word not in result.stdout, word
    assert LONG_DIGITS.search(result.stdout) is None


def _last_line(result: subprocess.CompletedProcess[str]) -> dict[str, object]:
    loaded: dict[str, object] = json.loads(result.stdout.splitlines()[-1])
    return loaded


def _runs(query: Query) -> list[tuple[object, ...]]:
    return query("select status, failed_step, error_kind from internal.batch_run order by run_id")


def test_real_entry_succeeds_with_fakes(batch_writer_url: str, query: Query) -> None:
    """壊さなければ、同じ土台で daily が最後まで通る（以降の検査の前提）。"""
    result = _run("plain", _as_url(batch_writer_url))
    assert result.returncode == 0
    assert result.stderr == ""
    for word in FORBIDDEN:
        assert word not in result.stdout, word
    assert _runs(query) == [("success", None, None)]
    assert query("select count(*) from internal.wp_post") == [(6,)]


@pytest.mark.parametrize(
    ("name", "step", "kind"),
    [
        # (a) 工程の途中の例外
        ("step_exception", "wp_fetch", "unknown"),
        # (d) 制約違反（エラーの詳細に行の値が入る）
        ("constraint_violation", "write", "db"),
        # (e) GA4 の例外（プロパティ ID を含む）
        ("ga4_exception", "ga4_daily", "network"),
        # (f) Deploy Hook の URL を含む httpx の例外
        ("hook_exception", "publish", "network"),
        # (g) 入力値に秘密らしい文字列が入った検証エラー
        ("validation_error", "wp_fetch", "validation"),
        # (h) 閉じたポートへの実際の gRPC 呼び出し
        ("grpc_closed_port", "ga4_daily", "network"),
        # (i) メッセージつきの sys.exit
        ("sys_exit_message", "wp_fetch", "unknown"),
        # (k) 独自のレベルとハンドラを持つロガーへの出力のあとの例外
        ("noisy_logger", "wp_fetch", "unknown"),
    ],
)
def test_i_b_11_failure_is_recorded_with_step_and_kind_only(
    batch_writer_url: str, query: Query, name: str, step: str, kind: str
) -> None:
    result = _run(name, _as_url(batch_writer_url))
    assert result.returncode == 1
    _assert_clean(result)
    assert _last_line(result) == {"step": step, "kind": kind}
    assert _runs(query) == [("failed", step, kind)]


def test_i_b_11_thread_exception(batch_writer_url: str, query: Query) -> None:
    """(b) スレッドの未処理例外。種別だけを出して、その場で終える。

    後始末を挟まずに終えるので、batch_run は running のまま残る。次回の preflight が
    失敗に直す（test_preflight_closes_abandoned_runs）。
    """
    result = _run("thread_exception", _as_url(batch_writer_url))
    assert result.returncode == 1
    _assert_clean(result)
    assert _last_line(result) == {"step": "startup", "kind": "unknown"}
    assert _runs(query) == [("running", None, None)]


def test_i_b_11_import_error(batch_writer_url: str, query: Query) -> None:
    """(j) 本体の import の途中の例外。batch_run には書けない（03 §14 の 6）。"""
    result = _run("import_error", _as_url(batch_writer_url))
    assert result.returncode == 1
    _assert_clean(result)
    assert result.stdout.strip() == '{"step":"startup","kind":"unknown"}'
    assert _runs(query) == []


@pytest.mark.parametrize(
    ("overrides", "step", "kinds"),
    [
        # 誤ったパスワード。接続の失敗は sqlstate を持たないことがあり、そのときは network
        ({"password": "wrong-hunter2"}, "preflight", {"auth", "network"}),
        # 存在しない host（.invalid は名前解決できないことが決まっている）
        ({"host": "db.invalid"}, "preflight", {"network"}),
    ],
)
def test_i_b_11_connection_failure(
    batch_writer_url: str, query: Query, overrides: dict[str, str], step: str, kinds: set[str]
) -> None:
    """(c) 接続の失敗。batch_run には書けないので、行の状態は求めない。"""
    result = _run("plain", _as_url(batch_writer_url, **overrides))
    assert result.returncode == 1
    _assert_clean(result)
    last = _last_line(result)
    assert last["step"] == step
    assert last["kind"] in kinds
    assert _runs(query) == []


@pytest.mark.parametrize(
    "db_url",
    [
        "postgresql://batch_writer:hunter2@[::1/postgres",
        "host=127.0.0.1 user=batch_writer password=hunter2",
        "postgresql://batch_writer:hunter2@pooler.example:5432/postgres?sslmode=disable",
    ],
)
def test_i_b_11_malformed_connection_string(clean_db: None, query: Query, db_url: str) -> None:
    """(c) 接続文字列の形式の誤り。接続する前に validation で止まる。"""
    result = _run("plain", db_url)
    assert result.returncode == 1
    _assert_clean(result)
    assert result.stdout.strip() == '{"step":"startup","kind":"validation"}'
    assert _runs(query) == []
