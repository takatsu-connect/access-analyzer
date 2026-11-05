"""工程の順序のうち、基準日の決定と工程 0（preflight）の分岐（03 §1、§3、§10、§14）。

DB、WordPress、GA4 には接続しない。db と wp_fetch の関数は monkeypatch で差し替える。
全工程を通した確認は結合テスト（I-B）で行う。
"""

import json
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta, timezone
from typing import NoReturn, Self
from zoneinfo import ZoneInfo

import httpx
import psycopg
import pytest
from pydantic import SecretStr

from support.fake_ga4 import FakeGa4
from takatsu_batch import db, pipeline, wp_fetch
from takatsu_batch.db import PriorState
from takatsu_batch.env import BatchEnv, DbTarget
from takatsu_batch.errors import BatchValidationError
from takatsu_batch.pipeline import Deps, RunRequest, resolve_base_date, run_batch

# JST では 2026-11-05 03:00。前日は 2026-11-04
NOW = datetime(2026, 11, 4, 18, 0, tzinfo=UTC)
LATEST = date(2026, 11, 4)
MEASUREMENT_START = date(2025, 10, 8)
RUN_ID = 42
# 例外のメッセージに入れる偽の接続文字列。出力に現れてはいけない
FAKE_DSN = "postgresql://batch_writer.fake:hunter2@pooler.invalid:6543/postgres"
LEAK_MARKERS = ("postgresql://", "batch_writer", "hunter2", "pooler", "localhost")
LOG_KEYS = {"step", "event", "kind", "count", "n", "duration_ms"}


def _env(base_date: date | None = None) -> BatchEnv:
    return BatchEnv(
        db=DbTarget(url=SecretStr("postgresql://u:p@localhost:5432/postgres"), is_local=True),
        ga4_property_id=SecretStr("123456789"),
        deploy_hook_url=SecretStr("https://deploy.invalid/hook"),
        base_date=base_date,
    )


# --- resolve_base_date ---


@pytest.mark.parametrize(
    ("now", "expected"),
    [
        (NOW, date(2026, 11, 4)),
        # JST の日付が変わった瞬間（UTC 15:00）
        (datetime(2026, 11, 4, 15, 0, tzinfo=UTC), date(2026, 11, 4)),
        # その 1 秒前は、UTC では同じ日でも JST ではまだ前の日
        (datetime(2026, 11, 4, 14, 59, 59, tzinfo=UTC), date(2026, 11, 3)),
        # 年末と月末
        (datetime(2025, 12, 31, 15, 0, tzinfo=UTC), date(2025, 12, 31)),
        (datetime(2025, 12, 31, 14, 59, 59, tzinfo=UTC), date(2025, 12, 30)),
        (datetime(2026, 2, 28, 15, 0, tzinfo=UTC), date(2026, 2, 28)),
        # 同じ時刻を JST で渡しても同じ
        (datetime(2026, 11, 5, 3, 0, tzinfo=timezone(timedelta(hours=9))), date(2026, 11, 4)),
    ],
)
def test_base_date_defaults_to_yesterday_in_jst(now: datetime, expected: date) -> None:
    assert resolve_base_date(RunRequest(mode="daily"), _env(), now) == expected


@pytest.mark.parametrize(
    ("backfill_to", "env_base_date", "expected"),
    [
        (None, None, LATEST),
        (None, date(2026, 10, 1), date(2026, 10, 1)),
        # backfill の to は BASE_DATE より優先する
        (date(2026, 9, 30), date(2026, 10, 1), date(2026, 9, 30)),
        (date(2026, 9, 30), None, date(2026, 9, 30)),
    ],
)
def test_base_date_priority(
    backfill_to: date | None, env_base_date: date | None, expected: date
) -> None:
    request = RunRequest(mode="backfill", backfill_from=MEASUREMENT_START, backfill_to=backfill_to)
    assert resolve_base_date(request, _env(env_base_date), NOW) == expected


@pytest.mark.parametrize(
    ("backfill_from", "backfill_to", "env_base_date", "expected"),
    [
        # 基準日は JST の前日まで
        (None, None, LATEST, LATEST),
        (None, LATEST, None, LATEST),
        # 計測開始日ちょうど
        (None, None, MEASUREMENT_START, MEASUREMENT_START),
        (MEASUREMENT_START, MEASUREMENT_START, None, MEASUREMENT_START),
        # from = to（1 日だけ）
        (date(2026, 10, 1), date(2026, 10, 1), None, date(2026, 10, 1)),
        # from だけを指定
        (LATEST, None, None, LATEST),
    ],
)
def test_base_date_accepts_the_edges(
    backfill_from: date | None,
    backfill_to: date | None,
    env_base_date: date | None,
    expected: date,
) -> None:
    mode: pipeline.RunMode = (
        "daily" if backfill_from is None and backfill_to is None else "backfill"
    )
    request = RunRequest(mode=mode, backfill_from=backfill_from, backfill_to=backfill_to)
    assert resolve_base_date(request, _env(env_base_date), NOW) == expected


@pytest.mark.parametrize(
    ("backfill_from", "backfill_to", "env_base_date"),
    [
        # 未来（JST の今日）
        (None, None, LATEST + timedelta(days=1)),
        (None, LATEST + timedelta(days=1), None),
        # 計測開始日より前
        (None, None, MEASUREMENT_START - timedelta(days=1)),
        (MEASUREMENT_START - timedelta(days=1), LATEST, None),
        # from > to
        (date(2026, 10, 2), date(2026, 10, 1), None),
        (LATEST + timedelta(days=1), None, None),
        (date(2026, 10, 2), None, date(2026, 10, 1)),
    ],
)
def test_base_date_rejects_out_of_range(
    backfill_from: date | None, backfill_to: date | None, env_base_date: date | None
) -> None:
    mode: pipeline.RunMode = (
        "daily" if backfill_from is None and backfill_to is None else "backfill"
    )
    request = RunRequest(mode=mode, backfill_from=backfill_from, backfill_to=backfill_to)
    with pytest.raises(BatchValidationError):
        resolve_base_date(request, _env(env_base_date), NOW)


# --- run_batch ---


class _FakeConnection:
    """context manager で、commit() を持つだけの偽の接続。"""

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *exc_info: object) -> None:
        return None

    def commit(self) -> None:
        return None


@dataclass
class _Recorder:
    calls: list[str] = field(default_factory=list)
    success_checked: list[date] = field(default_factory=list)
    started: list[tuple[date, str]] = field(default_factory=list)
    failures: list[tuple[int, str, str]] = field(default_factory=list)
    ga4_created: int = 0


def _patch_externals(monkeypatch: pytest.MonkeyPatch, *, has_success: bool) -> _Recorder:
    """db と wp_fetch を偽物にする。wp_fetch.fetch は呼ばれたら例外で止める。"""
    recorder = _Recorder()

    def connect(_target: DbTarget) -> _FakeConnection:
        recorder.calls.append("connect")
        return _FakeConnection()

    def close_abandoned_runs(_conn: object, _now: datetime) -> None:
        recorder.calls.append("close_abandoned_runs")

    def check_success(_conn: object, base_date: date, started_after: datetime) -> bool:
        recorder.calls.append("has_success")
        recorder.success_checked.append(base_date)
        # 揃う時刻は、基準日の翌日の JST 15:30（03 §2）
        assert started_after == datetime.combine(
            base_date + timedelta(days=1), time(15, 30), tzinfo=ZoneInfo("Asia/Tokyo")
        )
        return has_success

    def start_run(
        _conn: object,
        _started_at: datetime,
        base_date: date,
        mode: str,
        _threshold: int,
        _github_run_id: str | None,
    ) -> int:
        recorder.calls.append("start_run")
        recorder.started.append((base_date, mode))
        return RUN_ID

    def read_prior_state(_conn: object) -> PriorState:
        recorder.calls.append("read_prior_state")
        return PriorState(
            last_success_started_at=None,
            posts={},
            authors={},
            post_categories=frozenset(),
            post_tags=frozenset(),
            confirmed_months=frozenset(),
            referrer_months=frozenset(),
            city_months=frozenset(),
            referrer_computed={},
        )

    def finish_run_failed(
        _conn: object, run_id: int, step: str, kind: str, _counts: object
    ) -> None:
        recorder.calls.append("finish_run_failed")
        recorder.failures.append((run_id, step, kind))

    def wp_fetch_stub(_client: object, _prior: object, _base_date: date, *, full: bool) -> NoReturn:
        recorder.calls.append(f"wp_fetch.fetch(full={full})")
        raise RuntimeError(FAKE_DSN)

    monkeypatch.setattr(db, "connect", connect)
    monkeypatch.setattr(db, "close_abandoned_runs", close_abandoned_runs)
    monkeypatch.setattr(db, "has_success", check_success)
    monkeypatch.setattr(db, "start_run", start_run)
    monkeypatch.setattr(db, "read_prior_state", read_prior_state)
    monkeypatch.setattr(db, "finish_run_failed", finish_run_failed)
    monkeypatch.setattr(wp_fetch, "fetch", wp_fetch_stub)
    return recorder


@pytest.fixture
def ga4_created() -> list[FakeGa4]:
    return []


@pytest.fixture
def deps(ga4_created: list[FakeGa4]) -> Iterator[Deps]:
    def ga4_factory() -> FakeGa4:
        ga4_created.append(FakeGa4({}))
        return ga4_created[-1]

    # 通信はしない。Deps の形を満たすためだけに作る
    with httpx.Client() as http:
        yield Deps(
            http=http,
            ga4_factory=ga4_factory,
            sleep=lambda _seconds: None,
            clock=lambda: 0.0,
            now=lambda: NOW,
        )


def _log_lines(capsys: pytest.CaptureFixture[str]) -> list[str]:
    """出力の行を返す。固定の形の JSON だけで、秘密らしい文字列がなく、stderr が空であること。"""
    captured = capsys.readouterr()
    assert captured.err == ""
    for marker in LEAK_MARKERS:
        assert marker not in captured.out
    lines = captured.out.splitlines()
    for line in lines:
        assert set(json.loads(line)) <= LOG_KEYS
    return lines


def test_run_batch_returns_1_on_connection_failure_without_leaking_the_dsn(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    deps: Deps,
    ga4_created: list[FakeGa4],
) -> None:
    connects: list[DbTarget] = []

    def refuse(target: DbTarget) -> NoReturn:
        connects.append(target)
        raise psycopg.OperationalError(f'connection to "{FAKE_DSN}" failed')

    monkeypatch.setattr(db, "connect", refuse)

    assert run_batch(RunRequest(mode="daily"), _env(), deps) == 1
    lines = _log_lines(capsys)
    assert '{"step":"preflight","event":"start"}' in lines
    assert '{"step":"preflight","kind":"network"}' in lines
    # 実行の行を作る前の失敗なので、batch_run への記録のための再接続はしない
    assert len(connects) == 1
    assert ga4_created == []


def test_run_batch_returns_1_on_invalid_base_date_before_connecting(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], deps: Deps
) -> None:
    recorder = _patch_externals(monkeypatch, has_success=False)
    future = LATEST + timedelta(days=1)
    assert run_batch(RunRequest(mode="daily"), _env(future), deps) == 1
    assert '{"step":"preflight","kind":"validation"}' in _log_lines(capsys)
    assert recorder.calls == []


def test_run_batch_daily_skips_when_the_base_date_already_succeeded(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    deps: Deps,
    ga4_created: list[FakeGa4],
) -> None:
    recorder = _patch_externals(monkeypatch, has_success=True)

    assert run_batch(RunRequest(mode="daily"), _env(), deps) == 0
    lines = _log_lines(capsys)
    assert '{"step":"preflight","event":"skip"}' in lines
    assert not [line for line in lines if '"kind"' in line]
    # 同じ基準日（JST の前日）の成功を調べ、実行の行を作らず、取得もしない
    assert recorder.success_checked == [LATEST]
    assert recorder.calls == ["connect", "close_abandoned_runs", "has_success"]
    assert ga4_created == []


@pytest.mark.parametrize(
    ("request_", "has_success", "expected_full"),
    [
        # daily は成功がなければ進む
        (RunRequest(mode="daily"), False, False),
        # backfill は同じ基準日の成功があっても止めない（03 §10）
        (
            RunRequest(mode="backfill", backfill_from=MEASUREMENT_START, backfill_to=LATEST),
            True,
            True,
        ),
        (RunRequest(mode="backfill"), True, True),
    ],
)
def test_run_batch_proceeds_to_wp_fetch(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    deps: Deps,
    ga4_created: list[FakeGa4],
    request_: RunRequest,
    has_success: bool,
    expected_full: bool,
) -> None:
    recorder = _patch_externals(monkeypatch, has_success=has_success)

    # wp_fetch の偽物が例外で止めるので、戻り値は 1
    assert run_batch(request_, _env(), deps) == 1
    lines = _log_lines(capsys)
    assert '{"step":"preflight","event":"skip"}' not in lines
    assert '{"step":"preflight","event":"end"}' in lines
    assert '{"step":"wp_fetch","event":"start"}' in lines
    assert '{"step":"wp_fetch","kind":"unknown"}' in lines
    assert recorder.started == [(LATEST, request_.mode)]
    assert f"wp_fetch.fetch(full={expected_full})" in recorder.calls
    # 失敗は工程名と種別だけを batch_run に残す
    assert recorder.failures == [(RUN_ID, "wp_fetch", "unknown")]
    assert ga4_created == []
