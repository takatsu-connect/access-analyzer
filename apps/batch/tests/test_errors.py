"""U-29: classify_error と log_error（03 §14）。"""

import json
from typing import Any

import google.api_core.exceptions as google_api
import google.auth.exceptions as google_auth
import httpx
import psycopg
import psycopg.errors
import pydantic
import pytest

from takatsu_batch import log
from takatsu_batch.errors import classify_error

SECRET = "postgresql://batch_writer.abc:hunter2@pooler.example:5432/postgres"


class _Sample(pydantic.BaseModel):
    model_config = pydantic.ConfigDict(hide_input_in_errors=True)
    n: int


def _validation_error() -> pydantic.ValidationError:
    try:
        _Sample.model_validate({"n": SECRET})
    except pydantic.ValidationError as exc:
        return exc
    raise AssertionError


def _psycopg_error(sqlstate: str) -> psycopg.Error:
    return psycopg.errors.lookup(sqlstate)(SECRET)


@pytest.mark.parametrize(
    ("exc", "expected"),
    [
        (_validation_error(), "validation"),
        (google_api.ResourceExhausted(SECRET), "quota"),
        (google_api.PermissionDenied(SECRET), "auth"),
        (google_api.Unauthenticated(SECRET), "auth"),
        (google_api.RetryError(SECRET, cause=RuntimeError(SECRET)), "network"),
        (google_api.ServiceUnavailable(SECRET), "network"),
        (google_api.InternalServerError(SECRET), "network"),
        (google_auth.DefaultCredentialsError(SECRET), "auth"),
        (google_auth.RefreshError(SECRET), "auth"),
        (google_auth.GoogleAuthError(SECRET), "auth"),
        (httpx.ConnectError(SECRET), "network"),
        (httpx.ReadTimeout(SECRET), "network"),
        (_psycopg_error("28P01"), "auth"),
        (_psycopg_error("28000"), "auth"),
        (_psycopg_error("08006"), "network"),
        (_psycopg_error("53300"), "network"),
        (_psycopg_error("57014"), "network"),
        (_psycopg_error("22001"), "db"),
        (_psycopg_error("23505"), "db"),
        (_psycopg_error("42P01"), "db"),
        (_psycopg_error("42501"), "db"),
        (psycopg.OperationalError(SECRET), "network"),
        (psycopg.ProgrammingError(SECRET), "validation"),
        (psycopg.DatabaseError(SECRET), "db"),
        (psycopg.InterfaceError(SECRET), "db"),
        (RuntimeError(SECRET), "unknown"),
        (ValueError(SECRET), "unknown"),
        (KeyboardInterrupt(), "unknown"),
        (SystemExit(3), "unknown"),
    ],
)
def test_classify(exc: BaseException, expected: str) -> None:
    assert classify_error(exc) == expected


def test_classify_does_not_read_exception_contents() -> None:
    class Hostile(psycopg.OperationalError):
        def __str__(self) -> str:
            raise AssertionError

        __repr__ = __str__

        @property
        def diag(self) -> Any:
            raise AssertionError

    assert classify_error(Hostile()) == "network"


def test_log_error_outputs_only_step_and_kind(capsys: pytest.CaptureFixture[str]) -> None:
    exc = psycopg.errors.lookup("23505")(SECRET)
    exc.__cause__ = RuntimeError(SECRET)
    log.log_error("write", classify_error(exc))
    captured = capsys.readouterr()
    assert json.loads(captured.out) == {"step": "write", "kind": "db"}
    assert captured.err == ""


def test_log_replaces_values_outside_allow_list(capsys: pytest.CaptureFixture[str]) -> None:
    log.log_error(SECRET, SECRET)  # type: ignore[arg-type]
    log.log_count(SECRET, SECRET, SECRET)  # type: ignore[arg-type]
    log.log_step(SECRET, SECRET)  # type: ignore[arg-type]
    log.log_duration(SECRET, SECRET)  # type: ignore[arg-type]
    log.log_error(RuntimeError(SECRET), None)  # type: ignore[arg-type]
    out = capsys.readouterr().out
    assert "hunter2" not in out
    assert "postgresql" not in out
    assert out.count("\n") == 5


def test_log_functions_write_structured_lines(capsys: pytest.CaptureFixture[str]) -> None:
    log.log_step("write", "start")
    log.log_count("write", "rows_written", 12)
    log.log_duration("write", 345)
    log.log_count("write", "rows_written", True)
    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert lines == [
        {"step": "write", "event": "start"},
        {"step": "write", "count": "rows_written", "n": 12},
        {"step": "write", "duration_ms": 345},
        {"step": "write", "count": "rows_written", "n": -1},
    ]
