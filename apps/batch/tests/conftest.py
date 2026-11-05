"""テスト全体の外部接続の遮断と、結合テスト（I-DB、I-B）の接続（07 §1）。

対象サイト、本番の Supabase、GA4 には接続しない。結合テストの接続先はローカルだけに限る
（tests/support/localdb.py）。設定値は環境変数か、リポジトリ直下の .env から読む。
- DATABASE_URL: ローカルの管理接続。なければ結合テストを skip する。
- LOCAL_BATCH_WRITER_PASSWORD: batch_writer で接続する検査に使う。なければ該当の検査を skip する。
- SUPABASE_LOCAL_API_URL、SUPABASE_LOCAL_ANON_KEY: PostgREST 経由の検査に使う。
"""

import socket
from collections.abc import Iterator
from typing import Any

import psycopg
import pytest
from psycopg import sql
from psycopg.conninfo import make_conninfo

from support.localdb import assert_disposable_database, local_admin_url
from support.localenv import local_setting

_LOOPBACK_HOSTS = frozenset({"127.0.0.1", "::1", "localhost"})


def _is_loopback(host: object) -> bool:
    name = host.decode("ascii", "replace") if isinstance(host, bytes) else host
    return name is None or name in _LOOPBACK_HOSTS


@pytest.fixture(autouse=True)
def _block_external_network(monkeypatch: pytest.MonkeyPatch) -> None:
    """ループバック以外への名前解決と接続を失敗にする。

    respx を付け忘れたテストが、本物の対象サイトへ問い合わせないようにする（監査 L-1）。
    子プロセスと、libpq や gRPC の C 実装には効かない。
    """
    real_connect = socket.socket.connect
    real_getaddrinfo = socket.getaddrinfo

    def guarded_connect(self: socket.socket, address: Any) -> None:
        if isinstance(address, tuple) and not _is_loopback(address[0]):
            raise RuntimeError("tests must not connect to external hosts")
        real_connect(self, address)

    def guarded_getaddrinfo(host: Any, *args: Any, **kwargs: Any) -> Any:
        if not _is_loopback(host):
            raise RuntimeError("tests must not resolve external hosts")
        return real_getaddrinfo(host, *args, **kwargs)

    monkeypatch.setattr(socket.socket, "connect", guarded_connect)
    monkeypatch.setattr(socket, "getaddrinfo", guarded_getaddrinfo)


@pytest.fixture(scope="session")
def admin_url() -> str:
    return local_admin_url()


@pytest.fixture
def admin(admin_url: str) -> Iterator[psycopg.Connection[tuple[object, ...]]]:
    """管理接続。テストの変更は終了時にすべてロールバックする。"""
    with psycopg.connect(admin_url, autocommit=False) as conn:
        yield conn
        conn.rollback()


@pytest.fixture(scope="session")
def batch_writer_url(admin_url: str) -> Iterator[str]:
    """batch_writer を一時的に login にする。パスワードは .env の値を使い、出力しない。

    終了時に nologin へ戻す（02 §6 のマイグレーション適用後の状態）。
    """
    secret = local_setting("LOCAL_BATCH_WRITER_PASSWORD")
    if not secret:
        pytest.skip("LOCAL_BATCH_WRITER_PASSWORD がない")
    assert_disposable_database(admin_url)
    set_login = sql.SQL("alter role batch_writer login password {}").format(sql.Literal(secret))
    with psycopg.connect(admin_url, autocommit=True) as conn:
        conn.execute(set_login)
    try:
        yield make_conninfo(admin_url, user="batch_writer", password=secret)
    finally:
        with psycopg.connect(admin_url, autocommit=True) as conn:
            conn.execute("alter role batch_writer nologin password null")
