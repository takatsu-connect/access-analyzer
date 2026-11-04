"""I-DB の接続。接続先はローカルだけに限る（07 §1）。本番の接続文字列を使わない。

環境変数:
- DATABASE_URL: ローカルの管理接続。なければ skip する。
- LOCAL_BATCH_WRITER_PASSWORD: batch_writer で接続する検査に使う。なければ該当の検査を skip する。
- SUPABASE_LOCAL_API_URL、SUPABASE_LOCAL_ANON_KEY: PostgREST 経由の検査に使う。
"""

import os
from collections.abc import Iterator
from pathlib import Path

import psycopg
import pytest
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo

LOCAL_HOSTS = {"localhost", "127.0.0.1"}


def _read_dotenv(name: str) -> str | None:
    """リポジトリ直下の .env から 1 項目だけ読む。値を出力しない。"""
    path = Path(__file__).resolve().parents[4] / ".env"
    if not path.exists():
        return None
    for line in path.read_text(encoding="utf-8").splitlines():
        key, separator, value = line.partition("=")
        if separator and key.strip() == name:
            return value.strip() or None
    return None


def _local_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        pytest.skip("DATABASE_URL がない")
    host = conninfo_to_dict(url).get("host")
    if host not in LOCAL_HOSTS:
        pytest.fail("I-DB の接続先はローカルだけ", pytrace=False)
    return url


@pytest.fixture(scope="session")
def admin_url() -> str:
    return _local_url()


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
    secret = os.environ.get("LOCAL_BATCH_WRITER_PASSWORD") or _read_dotenv(
        "LOCAL_BATCH_WRITER_PASSWORD"
    )
    if not secret:
        pytest.skip("LOCAL_BATCH_WRITER_PASSWORD がない")
    set_login = sql.SQL("alter role batch_writer login password {}").format(sql.Literal(secret))
    with psycopg.connect(admin_url, autocommit=True) as conn:
        conn.execute(set_login)
    try:
        yield make_conninfo(admin_url, user="batch_writer", password=secret)
    finally:
        with psycopg.connect(admin_url, autocommit=True) as conn:
            conn.execute("alter role batch_writer nologin password null")
