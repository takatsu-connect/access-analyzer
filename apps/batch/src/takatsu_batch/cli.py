"""サブコマンドの受け口（01 §4、03 §2、§8、§10）。

本物の外部クライアントはここで作る。GA4 のクライアントは資格情報を読むので、使う工程まで作らない。
"""

import argparse
import os
import re
from collections.abc import Sequence
from contextlib import suppress
from datetime import date
from typing import Final

import httpx
from google.analytics.data_v1beta import BetaAnalyticsDataClient

from takatsu_batch import pipeline, publish
from takatsu_batch.env import load_batch_env, load_publish_hook
from takatsu_batch.errors import BatchValidationError
from takatsu_batch.ga4_client import Ga4Api

_ISO_DATE: Final = re.compile(r"\d{4}-\d{2}-\d{2}")
_PUBLISH_ONLY: Final = ("publish_only", "publish-only")


def _iso_date(value: str) -> date:
    """YYYY-MM-DD だけを受ける（BASE_DATE と同じ）。失敗のメッセージに入力値を入れない。"""
    if _ISO_DATE.fullmatch(value) is not None:
        with suppress(ValueError):
            return date.fromisoformat(value)
    raise argparse.ArgumentTypeError("date must be YYYY-MM-DD")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="takatsu_batch")
    # publish-only は 01 §4 の綴り、publish_only は workflow_dispatch の mode の綴り（03 §2）
    parser.add_argument("command", choices=("daily", "backfill", *_PUBLISH_ONLY))
    parser.add_argument("--from", dest="date_from", type=_iso_date)
    parser.add_argument("--to", dest="date_to", type=_iso_date)
    return parser


def _create_ga4_client() -> Ga4Api:
    client: Ga4Api = BetaAnalyticsDataClient()
    return client


def _http_client() -> httpx.Client:
    """プロキシや証明書の場所を環境変数から読まない（接続先と検証を環境に左右させない）。"""
    return httpx.Client(trust_env=False)


def _run_publish_only() -> int:
    """工程 7 だけ。batch_run に行を書かない（03 §2、L-7）。"""
    hook = load_publish_hook(os.environ)
    with _http_client() as http:
        publish.call_deploy_hook(http, hook)
    return 0


def dispatch(argv: Sequence[str]) -> int:
    """引数を解釈して工程を呼び、終了コードを返す。"""
    args = build_parser().parse_args(argv)
    if args.command != "backfill" and (args.date_from or args.date_to):
        # 期間の指定は backfill だけ。黙って無視しない
        raise BatchValidationError
    if args.command in _PUBLISH_ONLY:
        return _run_publish_only()
    env = load_batch_env(os.environ)
    with _http_client() as http:
        deps = pipeline.Deps(http=http, ga4_factory=_create_ga4_client)
        if args.command == "backfill":
            request = pipeline.RunRequest(
                "backfill", backfill_from=args.date_from, backfill_to=args.date_to
            )
        else:
            request = pipeline.RunRequest("daily")
        return pipeline.run_batch(request, env, deps)
