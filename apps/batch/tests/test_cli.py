"""引数の解釈（03 §2、§10）。期間の指定は backfill だけで、日付は YYYY-MM-DD だけを受ける。"""

from datetime import date

import pytest

from takatsu_batch import cli
from takatsu_batch.errors import BatchValidationError


def test_backfill_accepts_from_and_to() -> None:
    args = cli.build_parser().parse_args(["backfill", "--from", "2025-10-08", "--to", "2026-11-03"])
    assert (args.command, args.date_from, args.date_to) == (
        "backfill",
        date(2025, 10, 8),
        date(2026, 11, 3),
    )


@pytest.mark.parametrize("command", ["daily", "backfill", "publish_only", "publish-only"])
def test_commands(command: str) -> None:
    args = cli.build_parser().parse_args([command])
    assert (args.command, args.date_from, args.date_to) == (command, None, None)


@pytest.mark.parametrize(
    "value",
    ["20251008", "2025-W41-1", "2025-13-01", "2026-02-29", "1762000000", "2025/10/08", ""],
    ids=["basic", "iso-week", "month-13", "not-leap", "unix-time", "slashes", "empty"],
)
def test_dates_must_be_yyyy_mm_dd(value: str, capsys: pytest.CaptureFixture[str]) -> None:
    # BASE_DATE と同じ形だけを受ける。失敗のメッセージに入力値を入れない
    with pytest.raises(SystemExit) as excinfo:
        cli.build_parser().parse_args(["backfill", "--from", value])
    assert excinfo.value.code == 2
    error_line = capsys.readouterr().err.splitlines()[-1]
    assert error_line.endswith("argument --from: date must be YYYY-MM-DD")


@pytest.mark.parametrize(
    "argv",
    [
        ["daily", "--from", "2025-10-08"],
        ["daily", "--to", "2026-11-03"],
        ["publish_only", "--to", "2026-11-03"],
        ["publish-only", "--from", "2025-10-08"],
    ],
)
def test_period_arguments_are_rejected_outside_backfill(
    argv: list[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    # 黙って無視しない。環境変数を読む前に止まる
    for name in ("SUPABASE_BATCH_DB_URL", "GA4_PROPERTY_ID", "VERCEL_DEPLOY_HOOK_URL"):
        monkeypatch.delenv(name, raising=False)
    with pytest.raises(BatchValidationError):
        cli.dispatch(argv)


def test_http_client_ignores_proxy_and_certificate_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # プロキシや証明書の場所を環境変数から読まない（監査 L-4）
    monkeypatch.setenv("HTTPS_PROXY", "http://proxy.invalid:3128")
    monkeypatch.setenv("SSL_CERT_FILE", "/nonexistent/ca.pem")
    with cli._http_client() as http:
        assert http.trust_env is False
