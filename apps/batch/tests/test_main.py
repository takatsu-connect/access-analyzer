"""__main__.py の起動順（03 §14 の 4・5）。

出力を塞ぐ効果は子プロセスで確かめる。pytest の中で fd 2 を塞がない。
"""

import logging
import os
import subprocess
import sys
import textwrap
import threading
from pathlib import Path

import pytest

from takatsu_batch import __main__ as entry

SRC = Path(__file__).resolve().parents[1] / "src"
SECRET = "postgresql://batch_writer.abc:hunter2@pooler.example:5432/postgres"
FORBIDDEN = ("postgresql://", "pooler", "batch_writer", "hunter2", "Traceback", "https://")
FAILURE_LINE = '{"step":"startup","kind":"unknown"}'


def _env() -> dict[str, str]:
    env = {**os.environ, "PYTHONPATH": str(SRC), "PYTHONIOENCODING": "utf-8"}
    env.pop("GRPC_VERBOSITY", None)
    return env


def _run_entry_with_fake_cli(body: str) -> subprocess.CompletedProcess[str]:
    """takatsu_batch.cli を偽物に替えて、本物のエントリを __main__ として動かす。"""
    script = textwrap.dedent(
        """
        import runpy, sys, types
        fake = types.ModuleType("takatsu_batch.cli")
        def dispatch(argv):
        {body}
        fake.dispatch = dispatch
        sys.modules["takatsu_batch.cli"] = fake
        runpy.run_module("takatsu_batch", run_name="__main__", alter_sys=True)
        """
    ).format(body=textwrap.indent(textwrap.dedent(body), "    "))
    return subprocess.run(
        [sys.executable, "-c", script],
        env=_env(),
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )


def _assert_clean(result: subprocess.CompletedProcess[str]) -> None:
    assert result.stderr == ""
    for word in FORBIDDEN:
        assert word not in result.stdout


def test_harden_order_follows_design(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []
    for name in (
        "_redirect_stderr_fd",
        "_install_hooks",
        "_disable_logging",
        "_silence_grpc",
        "_silence_library_loggers",
    ):
        monkeypatch.setattr(entry, name, lambda n=name: calls.append(n))
    entry.harden_process()
    assert calls == [
        "_redirect_stderr_fd",
        "_install_hooks",
        "_disable_logging",
        "_silence_grpc",
        "_silence_library_loggers",
    ]


@pytest.mark.parametrize(
    ("code", "expected"),
    [(None, 0), (0, 0), (3, 3), (True, True), ("message", 1), ({"a": 1}, 1)],
)
def test_normalized_exit_code(code: object, expected: int) -> None:
    assert entry._normalized_exit_code(SystemExit(code)) == expected


def test_real_entry_without_implementation_fails_with_kind_only() -> None:
    result = subprocess.run(
        [sys.executable, "-m", "takatsu_batch", "daily"],
        env=_env(),
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    assert result.returncode == 1
    assert result.stdout.strip() == FAILURE_LINE
    assert result.stderr == ""


def test_invalid_arguments_do_not_echo_input() -> None:
    result = subprocess.run(
        [sys.executable, "-m", "takatsu_batch", SECRET],
        env=_env(),
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    assert result.returncode == 2
    assert result.stdout.strip() == FAILURE_LINE
    _assert_clean(result)


def test_exception_message_is_not_output() -> None:
    result = _run_entry_with_fake_cli(f"raise RuntimeError({SECRET!r})")
    assert result.returncode == 1
    assert result.stdout.strip() == FAILURE_LINE
    _assert_clean(result)


def test_classified_exception_outputs_kind() -> None:
    result = _run_entry_with_fake_cli(
        f"""
        import psycopg
        raise psycopg.OperationalError({SECRET!r})
        """
    )
    assert result.returncode == 1
    assert result.stdout.strip() == '{"step":"startup","kind":"network"}'
    _assert_clean(result)


@pytest.mark.parametrize(
    ("statement", "code", "out"),
    [
        ("sys.exit(0)", 0, ""),
        ("sys.exit()", 0, ""),
        ("sys.exit(3)", 3, FAILURE_LINE),
        (f"sys.exit({SECRET!r})", 1, FAILURE_LINE),
    ],
)
def test_system_exit(statement: str, code: int, out: str) -> None:
    result = _run_entry_with_fake_cli(f"import sys; {statement}")
    assert result.returncode == code
    assert result.stdout.strip() == out
    _assert_clean(result)


def test_output_paths_are_closed_while_running() -> None:
    result = _run_entry_with_fake_cli(
        f"""
        import logging, os, sys, warnings
        os.write(2, {SECRET!r}.encode())
        sys.stderr.write({SECRET!r})
        sys.stderr.flush()
        warnings.warn({SECRET!r})
        logging.getLogger("httpx").error({SECRET!r})
        logging.getLogger("httpx").addHandler(logging.StreamHandler(sys.stdout))
        logging.getLogger("httpx").critical({SECRET!r})
        logging.getLogger().critical({SECRET!r})
        assert os.environ["GRPC_VERBOSITY"] == "NONE"
        assert logging.lastResort is None
        assert logging.raiseExceptions is False
        import faulthandler
        assert not faulthandler.is_enabled()
        """
    )
    assert result.returncode == 0
    assert result.stdout == ""
    _assert_clean(result)


def test_thread_exception_exits_with_kind_only() -> None:
    result = _run_entry_with_fake_cli(
        f"""
        import threading, time
        def boom():
            raise RuntimeError({SECRET!r})
        thread = threading.Thread(target=boom)
        thread.start()
        thread.join()
        time.sleep(30)
        """
    )
    assert result.returncode == 1
    assert result.stdout.strip() == FAILURE_LINE
    _assert_clean(result)


def test_unraisable_is_silent() -> None:
    result = _run_entry_with_fake_cli(
        f"""
        import gc
        class Bad:
            def __del__(self):
                raise RuntimeError({SECRET!r})
        Bad()
        gc.collect()
        """
    )
    assert result.returncode == 0
    assert result.stdout == ""
    _assert_clean(result)


def test_entry_module_import_has_no_side_effect() -> None:
    # pytest の import で fd 2 を塞がない。hook も既定のまま（__init__ と __main__ の import のみ）
    assert sys.excepthook is not entry._write_fallback_and_exit
    assert threading.excepthook is not entry._write_fallback_and_exit
    assert logging.root.manager.disable == 0
