"""バッチの唯一のロガー（03 §15、NFR-44）。

引数は固定の種別、件数、所要時間に限る。任意のオブジェクトを出す関数を作らない。
Literal は実行時に効かないので、許可の外の値は固定の語に置き換える。
"""

import json
import sys
from typing import Final, Literal, get_args

type Step = Literal[
    "startup",
    "preflight",
    "wp_fetch",
    "period",
    "ga4_daily",
    "ga4_period",
    "derive",
    "write",
    "publish",
]
type ErrorKind = Literal["quota", "auth", "network", "validation", "db", "unknown"]
type CountName = Literal[
    "ga4_requests",
    "ga4_tokens",
    "ga4_tokens_remaining_day",
    "ga4_tokens_remaining_hour",
    "wp_requests",
    "posts_upserted",
    "posts_deleted",
    "rows_written",
]
type StepEvent = Literal["start", "end"]

_STEPS: Final[frozenset[str]] = frozenset(get_args(Step.__value__))
_KINDS: Final[frozenset[str]] = frozenset(get_args(ErrorKind.__value__))
_COUNT_NAMES: Final[frozenset[str]] = frozenset(get_args(CountName.__value__))
_STEP_EVENTS: Final[frozenset[str]] = frozenset(get_args(StepEvent.__value__))
_UNKNOWN_LABEL: Final = "unknown"


def _emit(record: dict[str, str | int]) -> None:
    sys.stdout.write(json.dumps(record, ensure_ascii=True, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def _label(value: str, allowed: frozenset[str]) -> str:
    return value if isinstance(value, str) and value in allowed else _UNKNOWN_LABEL


def _count(value: int) -> int:
    # 数値以外を渡されても中身を出さない
    return value if type(value) is int else -1


def log_step(step: Step, event: StepEvent) -> None:
    """工程の開始と終了。"""
    _emit({"step": _label(step, _STEPS), "event": _label(event, _STEP_EVENTS)})


def log_count(step: Step, name: CountName, n: int) -> None:
    """件数。"""
    _emit({"step": _label(step, _STEPS), "count": _label(name, _COUNT_NAMES), "n": _count(n)})


def log_duration(step: Step, duration_ms: int) -> None:
    """所要時間（ミリ秒）。"""
    _emit({"step": _label(step, _STEPS), "duration_ms": _count(duration_ms)})


def log_error(step: Step, kind: ErrorKind) -> None:
    """失敗した工程と種別だけを出す（03 §14）。"""
    _emit({"step": _label(step, _STEPS), "kind": _label(kind, _KINDS)})
