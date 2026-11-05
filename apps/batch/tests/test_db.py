"""U-30（db.py の部分）: 接続のキーワードと TLS の固定（03 §7、ADR 0009「接続」「TLS」、NFR-40）。

psycopg.connect は偽物に替え、データベースには接続しない。接続文字列は架空の値。
SQL を持つ関数（実行記録、前回の状態）は結合テスト（I-B）で確かめる。
"""

import hashlib
import ssl
from pathlib import Path
from typing import Any

import pytest
from psycopg import pq
from pydantic import SecretStr

from takatsu_batch import db
from takatsu_batch.env import DbTarget, parse_db_url

PROD_URL = "postgresql://batch_writer.abcdefgh:hunter2-fake@db.pooler.example:5432/postgres"
LOCAL_URL = "postgresql://postgres:postgres@localhost:54322/postgres"
LOOPBACK_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
LOOKALIKE_URL = "postgresql://postgres:postgres@localhost.evil.example:54322/postgres"
CA_CERT = Path(__file__).resolve().parents[1] / "certs" / "supabase-root-2021.crt"
# ADR 0009 に記録した Supabase Root 2021 CA の SHA-256 指紋
CA_FINGERPRINT = (
    "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:"
    "82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA"
)
BASE_KWARGS = {"prepare_threshold": None, "connect_timeout": 10, "autocommit": False}
TLS_KEYS = {"sslmode", "sslrootcert", "require_auth"}


def _target(url: str, *, is_local: bool) -> DbTarget:
    return DbTarget(url=SecretStr(url), is_local=is_local)


# --- connect_kwargs ---


def test_connect_kwargs_for_local_has_no_tls_settings() -> None:
    kwargs = db.connect_kwargs(_target(LOCAL_URL, is_local=True))
    assert kwargs == BASE_KWARGS
    assert not TLS_KEYS & set(kwargs)


def test_connect_kwargs_for_remote_fixes_tls() -> None:
    kwargs = db.connect_kwargs(_target(PROD_URL, is_local=False))
    assert kwargs == {
        **BASE_KWARGS,
        "sslmode": "verify-full",
        "sslrootcert": str(CA_CERT),
        # 暗号化は TLS だけ。環境に Kerberos の資格情報があっても GSS を試さない（監査 L-4）
        "gssencmode": "disable",
        "require_auth": "scram-sha-256",
    }


def test_bundled_libpq_supports_require_auth() -> None:
    """同梱の libpq が 16 未満になると require_auth が黙って外れるので、ここで気づく。"""
    assert pq.version() >= 160000


@pytest.mark.parametrize(
    ("libpq_version", "expected"),
    [(150004, False), (159999, False), (160000, True), (180004, True)],
)
def test_require_auth_depends_on_libpq_version(
    monkeypatch: pytest.MonkeyPatch, libpq_version: int, expected: bool
) -> None:
    monkeypatch.setattr("takatsu_batch.db.pq.version", lambda: libpq_version)
    kwargs = db.connect_kwargs(_target(PROD_URL, is_local=False))
    assert ("require_auth" in kwargs) is expected
    # 版が古くても、TLS の検証は外れない
    assert kwargs["sslmode"] == "verify-full"
    assert kwargs["sslrootcert"] == str(CA_CERT)
    local = db.connect_kwargs(_target(LOCAL_URL, is_local=True))
    assert "require_auth" not in local


def test_connect_kwargs_never_contains_the_url() -> None:
    kwargs = db.connect_kwargs(_target(PROD_URL, is_local=False))
    assert "hunter2" not in repr(kwargs)
    assert "pooler" not in repr(kwargs)


# --- 固定した CA ---


def test_ca_cert_is_absolute_and_exists() -> None:
    path = Path(db.connect_kwargs(_target(PROD_URL, is_local=False))["sslrootcert"])
    assert path == CA_CERT
    assert path == db.CA_CERT_PATH
    assert path.is_absolute()
    assert path.is_file()
    assert path.parts[-4:] == ("apps", "batch", "certs", "supabase-root-2021.crt")
    assert path.read_text(encoding="ascii").startswith("-----BEGIN CERTIFICATE-----")


def test_ca_cert_matches_fingerprint_in_adr() -> None:
    der = ssl.PEM_cert_to_DER_cert(CA_CERT.read_text(encoding="ascii"))
    digest = hashlib.sha256(der).hexdigest().upper()
    assert ":".join(digest[index : index + 2] for index in range(0, 64, 2)) == CA_FINGERPRINT


# --- connect ---


@pytest.mark.parametrize(
    ("url", "expects_tls"),
    [
        pytest.param(LOCAL_URL, False, id="localhost"),
        pytest.param(LOOPBACK_URL, False, id="loopback"),
        pytest.param(PROD_URL, True, id="pooler"),
        pytest.param(LOOKALIKE_URL, True, id="localhost-lookalike"),
    ],
)
def test_connect_passes_raw_url_and_fixed_keywords(
    monkeypatch: pytest.MonkeyPatch, url: str, expects_tls: bool
) -> None:
    calls: list[tuple[tuple[Any, ...], dict[str, Any]]] = []
    connection = object()

    def fake_connect(*args: Any, **kwargs: Any) -> object:
        calls.append((args, kwargs))
        return connection

    monkeypatch.setattr("takatsu_batch.db.psycopg.connect", fake_connect)
    target = parse_db_url(SecretStr(url))
    assert db.connect(target) is connection
    assert calls == [((url,), db.connect_kwargs(target))]
    kwargs = calls[0][1]
    assert kwargs["prepare_threshold"] is None
    assert kwargs["connect_timeout"] == 10
    assert kwargs["autocommit"] is False
    if expects_tls:
        assert kwargs["sslmode"] == "verify-full"
        assert kwargs["sslrootcert"] == str(CA_CERT)
        assert kwargs["require_auth"] == "scram-sha-256"
    else:
        assert not TLS_KEYS & set(kwargs)
