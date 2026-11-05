"""環境変数の検証（03 §16、ADR 0009「TLS」）。mode ごとに必須の変数だけを見る。

接続文字列は SecretStr で持ち、値をメッセージに入れない。TLS の設定を接続文字列に頼らないので、
解析した実効値が host、port、user、password、dbname だけであることを確かめる。
"""

import re
from collections.abc import Mapping
from datetime import date
from typing import Final
from urllib.parse import urlsplit

import psycopg
from psycopg.conninfo import conninfo_to_dict
from pydantic import SecretStr, field_validator

from takatsu_batch.errors import BatchValidationError
from takatsu_batch.models import BatchModel

_ALLOWED_CONNINFO_KEYS: Final = frozenset({"host", "port", "user", "password", "dbname"})
_LOCAL_HOSTS: Final = frozenset({"localhost", "127.0.0.1"})
_URL_SCHEMES: Final = frozenset({"postgresql", "postgres"})
_ISO_DATE: Final = re.compile(r"\d{4}-\d{2}-\d{2}")
_HOOK_URL_PREFIX: Final = "https://api.vercel.com/v1/integrations/deploy/"


class DbTarget(BatchModel):
    url: SecretStr
    is_local: bool


class BatchEnv(BatchModel):
    db: DbTarget
    ga4_property_id: SecretStr
    deploy_hook_url: SecretStr
    base_date: date | None = None
    github_run_id: str | None = None


class _BatchEnvInput(BatchModel):
    SUPABASE_BATCH_DB_URL: SecretStr
    GA4_PROPERTY_ID: SecretStr
    VERCEL_DEPLOY_HOOK_URL: SecretStr
    BASE_DATE: date | None = None
    GITHUB_RUN_ID: str | None = None

    @field_validator("BASE_DATE", mode="before")
    @classmethod
    def _only_iso_date(cls, value: object) -> object:
        """YYYY-MM-DD だけを受ける。数字だけの文字列を UNIX 時刻として読ませない。"""
        if isinstance(value, str) and _ISO_DATE.fullmatch(value) is None:
            raise ValueError("BASE_DATE must be YYYY-MM-DD")
        return value


class _PublishEnvInput(BatchModel):
    VERCEL_DEPLOY_HOOK_URL: SecretStr


def parse_db_url(url: SecretStr) -> DbTarget:
    """接続文字列の実効値を検査する。

    libpq の URI は `?host=` が前の host を上書きするので、クエリ文字列はそれ自体を拒否する。
    """
    raw = url.get_secret_value()
    try:
        parts = urlsplit(raw)
        if parts.scheme not in _URL_SCHEMES or parts.query or parts.fragment:
            raise BatchValidationError
        parsed = conninfo_to_dict(raw)
    except (ValueError, psycopg.Error):
        raise BatchValidationError from None
    if not set(parsed) <= _ALLOWED_CONNINFO_KEYS:
        raise BatchValidationError
    host = parsed.get("host")
    # 複数の host、Unix ソケット（/ で始まる）、抽象ソケット（@ で始まる）は受けない
    if not isinstance(host, str) or not host or "," in host or host[0] in "/@":
        raise BatchValidationError
    return DbTarget(url=url, is_local=host in _LOCAL_HOSTS)


def _present(environ: Mapping[str, str], names: frozenset[str]) -> dict[str, str]:
    """空文字は未設定として扱う（workflow_dispatch の空の入力）。"""
    return {name: environ[name] for name in names if environ.get(name)}


def _check_hook_url(url: SecretStr) -> None:
    """POST の宛先は Vercel の Deploy Hook に限る。"""
    if not url.get_secret_value().startswith(_HOOK_URL_PREFIX):
        raise BatchValidationError


def _is_ascii_digits(value: str) -> bool:
    return value.isascii() and value.isdigit()


def load_batch_env(environ: Mapping[str, str]) -> BatchEnv:
    """daily と backfill に必要な環境変数。"""
    values = _BatchEnvInput.model_validate(
        _present(environ, frozenset(_BatchEnvInput.model_fields))
    )
    if not _is_ascii_digits(values.GA4_PROPERTY_ID.get_secret_value()):
        raise BatchValidationError
    # batch_run に書く値なので、数字だけにする
    if values.GITHUB_RUN_ID is not None and not _is_ascii_digits(values.GITHUB_RUN_ID):
        raise BatchValidationError
    _check_hook_url(values.VERCEL_DEPLOY_HOOK_URL)
    return BatchEnv(
        db=parse_db_url(values.SUPABASE_BATCH_DB_URL),
        ga4_property_id=values.GA4_PROPERTY_ID,
        deploy_hook_url=values.VERCEL_DEPLOY_HOOK_URL,
        base_date=values.BASE_DATE,
        github_run_id=values.GITHUB_RUN_ID,
    )


def load_publish_hook(environ: Mapping[str, str]) -> SecretStr:
    """publish_only が必要とするのは Deploy Hook だけ（03 §16）。"""
    values = _PublishEnvInput.model_validate(
        _present(environ, frozenset(_PublishEnvInput.model_fields))
    )
    _check_hook_url(values.VERCEL_DEPLOY_HOOK_URL)
    return values.VERCEL_DEPLOY_HOOK_URL
