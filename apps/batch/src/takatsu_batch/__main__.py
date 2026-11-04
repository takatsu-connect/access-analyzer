"""バッチのエントリ。起動順は 03 §14 の 4・5（W-7）に従う。

このファイルの最上位の import は標準ライブラリだけにする。第三者のライブラリと本体は、
出力を塞いだ後で関数の中から遅延 import する（import 時の例外を既定の表示にしないため）。
例外の情報はどこにも渡さない。使ってよいのは種別への分類と、SystemExit の終了コードの判定だけ。
"""

import logging
import os
import sys
import threading
import warnings
from collections.abc import Callable
from typing import Final, NoReturn

# 本体を import する前に出す固定の行。log.py と同じ形にする。
_FALLBACK_ERROR_LINE: Final = '{"step":"startup","kind":"unknown"}\n'


def _redirect_stderr_fd() -> None:
    """fd 2 を捨てる。ネイティブのライブラリの出力は Python のフックを通らないため。"""
    devnull = os.open(os.devnull, os.O_WRONLY)
    os.dup2(devnull, 2)
    os.close(devnull)


def _write_fallback_and_exit(*_args: object) -> NoReturn:
    """種別だけを出して、後始末の出力を挟まずに終える。"""
    try:
        sys.stdout.write(_FALLBACK_ERROR_LINE)
        sys.stdout.flush()
    finally:
        os._exit(1)


def _ignore_unraisable(_unraisable: object) -> None:
    """unraisable は何も出さない。"""


def _install_hooks() -> None:
    sys.excepthook = _write_fallback_and_exit
    threading.excepthook = _write_fallback_and_exit
    sys.unraisablehook = _ignore_unraisable
    warnings.simplefilter("ignore")


def _disable_logging() -> None:
    logging.disable(logging.CRITICAL)
    logging.raiseExceptions = False


def _silence_grpc() -> None:
    # gRPC の import より前に設定する。ワークフローの設定に頼らない。
    os.environ["GRPC_VERBOSITY"] = "NONE"


def _silence_library_loggers() -> None:
    """httpx などの INFO を止める。既定のハンドラ設定は呼ばない（03 §14 の 5）。"""
    root = logging.getLogger()
    root.addHandler(logging.NullHandler())
    root.setLevel(logging.CRITICAL + 1)
    logging.lastResort = None


def harden_process() -> None:
    """本体を読み込む前に、出力の経路を 03 §14 の順に塞ぐ。"""
    _redirect_stderr_fd()
    _install_hooks()
    _disable_logging()
    _silence_grpc()
    _silence_library_loggers()


def _normalized_exit_code(exc: SystemExit) -> int:
    """code が int か None ならそのまま、それ以外（文字列など）は 1 にする。"""
    code = exc.code
    if code is None:
        return 0
    return code if isinstance(code, int) else 1


def _unknown_kind(_exc: BaseException) -> str:
    """分類器を読み込めないときの代わり。"""
    return "unknown"


def _load_classifier() -> Callable[[BaseException], str]:
    """分類器を読み込む。読み込みに失敗したら、すべて unknown に分類する。"""
    try:
        from takatsu_batch.errors import classify_error
    except BaseException:
        return _unknown_kind
    return classify_error


def _report_failure(kind: str) -> None:
    from takatsu_batch.log import log_error

    log_error("startup", kind)  # type: ignore[arg-type]  # log_error が許可の外の値を置き換える


def main() -> None:
    """全工程を囲み、失敗は種別だけを出して終了コードで知らせる。再送出しない。"""
    harden_process()
    classify_error: Callable[[BaseException], str] = _unknown_kind
    try:
        classify_error = _load_classifier()
        from takatsu_batch.cli import dispatch

        dispatch(sys.argv[1:])
    except SystemExit as exc:
        code = _normalized_exit_code(exc)
        if code != 0:
            # 工程の途中の 0 以外の SystemExit は失敗として扱う（種別は unknown）
            _report_failure("unknown")
        sys.exit(code)
    except BaseException as exc:
        _report_failure(classify_error(exc))
        sys.exit(1)


if __name__ == "__main__":
    main()
