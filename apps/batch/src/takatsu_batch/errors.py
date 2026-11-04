"""例外の分類（03 §14 の 3）。例外の型と sqlstate だけを見る。

メッセージ、引数、diag、原因の連鎖を読まない。tests/test_static_rules.py が検査する。
"""

from typing import Final

import google.api_core.exceptions as google_api
import google.auth.exceptions as google_auth
import httpx
import psycopg
import pydantic

from takatsu_batch.log import ErrorKind

_NETWORK_SQLSTATE_CLASSES: Final = frozenset({"08", "53", "57"})


def _classify_psycopg(exc: psycopg.Error) -> ErrorKind:
    sqlstate = exc.sqlstate
    if sqlstate is None:
        if isinstance(exc, psycopg.OperationalError):
            return "network"
        if isinstance(exc, psycopg.ProgrammingError):
            return "validation"
        return "db"
    sqlstate_class = sqlstate[:2]
    if sqlstate_class == "28":
        return "auth"
    if sqlstate_class in _NETWORK_SQLSTATE_CLASSES:
        return "network"
    return "db"


def classify_error(exc: BaseException) -> ErrorKind:
    """種別を返す。分類できないものは `unknown`。"""
    if isinstance(exc, pydantic.ValidationError):
        return "validation"
    if isinstance(exc, google_api.ResourceExhausted):
        return "quota"
    if isinstance(exc, google_api.PermissionDenied | google_api.Unauthenticated):
        return "auth"
    if isinstance(exc, google_api.RetryError | google_api.GoogleAPICallError):
        return "network"
    if isinstance(exc, google_auth.GoogleAuthError):
        return "auth"
    if isinstance(exc, httpx.HTTPError):
        return "network"
    if isinstance(exc, psycopg.Error):
        return _classify_psycopg(exc)
    return "unknown"
