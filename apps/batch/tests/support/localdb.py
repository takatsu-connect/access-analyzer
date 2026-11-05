"""結合テストの接続先をローカルの Supabase に限るための検査（07 §1、監査 M-1）。

結合テストは内部表を空にし、batch_writer のパスワードを付け替える。本番に向かないよう、
接続文字列の検査、宛先の固定、DB の中身の確認の 3 つで止める。値を出力しない。
"""

import os

import psycopg
import pytest
from psycopg.conninfo import conninfo_to_dict, make_conninfo

from support.localenv import local_setting

LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1"})
LOOPBACK = "127.0.0.1"
_ALLOWED_KEYS = frozenset({"host", "port", "user", "password", "dbname"})
# libpq が宛先を変える環境変数。残っている環境では動かさない
_REDIRECTING_ENV = ("PGHOSTADDR", "PGSERVICE", "PGSERVICEFILE")


def local_admin_url() -> str:
    """ローカルの管理接続。なければ skip、ローカルでなければ失敗。宛先はループバックに固定する。"""
    url = local_setting("DATABASE_URL")
    if not url:
        pytest.skip("DATABASE_URL がない")
    if any(os.environ.get(name) for name in _REDIRECTING_ENV):
        pytest.fail(
            "宛先を変える PG の環境変数がある環境では、結合テストを動かさない", pytrace=False
        )
    try:
        parts = conninfo_to_dict(url)
    except psycopg.Error:
        pytest.fail("DATABASE_URL の形式が正しくない", pytrace=False)
    # hostaddr や service など、host 以外で宛先を変える指定を受けない
    if not set(parts) <= _ALLOWED_KEYS or parts.get("host") not in LOCAL_HOSTS:
        pytest.fail("結合テストの接続先はローカルだけ", pytrace=False)
    return make_conninfo(url, hostaddr=LOOPBACK)


def assert_disposable_database(admin_url: str) -> None:
    """GitHub Actions の実行記録がある DB（本番）には、表を空にする準備をしない。

    ローカルへのポート転送の先が本番だった場合の歯止め。テストは github_run_id を書かない。
    """
    with psycopg.connect(admin_url, autocommit=True) as conn:
        row = conn.execute(
            "select exists (select 1 from internal.batch_run where github_run_id is not null)"
        ).fetchone()
    if row is None or row[0]:
        pytest.fail("GitHub Actions の実行記録がある DB には、結合テストで触れない", pytrace=False)
