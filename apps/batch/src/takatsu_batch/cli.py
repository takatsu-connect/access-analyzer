"""サブコマンドの受け口（01 §4）。工程の本体は構築 2 で作る。"""

import argparse
from collections.abc import Sequence


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="takatsu_batch")
    parser.add_argument("command", choices=("daily", "backfill", "publish-only"))
    return parser


def dispatch(argv: Sequence[str]) -> None:
    """引数を解釈して工程を呼ぶ。今回は未実装なので必ず失敗する。"""
    build_parser().parse_args(argv)
    raise NotImplementedError
