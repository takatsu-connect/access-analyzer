"""I-B-11 の土台: 本物のエントリを子プロセスで動かし、外部を偽物に替えて壊し方を 1 つだけ起こす。

使い方: python entry_harness.py <壊し方の名前>。テスト以外から使わない。

最上位の import は標準ライブラリだけにする。第三者のライブラリと本体は、本物のエントリが出力を
塞いだ後（dispatch の中）で読み込む。本番と同じ順にするため（03 §14 の 4）。
"""

import importlib
import importlib.abc
import runpy
import sys
import types
from collections.abc import Callable, Sequence
from datetime import date
from importlib.machinery import ModuleSpec
from typing import Any, NoReturn

# 例外やログに入りうる秘密の代わり。出力に現れてはいけない
SECRET = "postgresql://batch_writer.abc:hunter2@pooler.example:5432/postgres"
_CLI = "takatsu_batch.cli"


def _raise_secret(*_args: object, **_kwargs: object) -> NoReturn:
    raise RuntimeError(SECRET)


def _raise_in_thread(*_args: object, **_kwargs: object) -> None:
    import threading
    import time

    thread = threading.Thread(target=_raise_secret)
    thread.start()
    thread.join()
    time.sleep(30)


def _exit_with_message(*_args: object, **_kwargs: object) -> NoReturn:
    sys.exit(SECRET)


def _log_and_raise(*_args: object, **_kwargs: object) -> NoReturn:
    """独自のレベルとハンドラを持つロガーに出してから失敗する。"""
    import logging

    logger = logging.getLogger("noisy")
    logger.setLevel(logging.DEBUG)
    logger.addHandler(logging.StreamHandler(sys.stderr))
    logger.addHandler(logging.StreamHandler(sys.stdout))
    logger.error(SECRET)
    logger.critical(SECRET)
    raise RuntimeError(SECRET)


def _closed_port_client() -> object:
    """閉じたポートに向けた本物の gRPC クライアント。偽の GA4 では C 実装の出力を通らないため。"""
    import socket

    import grpc  # type: ignore[import-untyped]
    from google.analytics.data_v1beta import BetaAnalyticsDataClient
    from google.analytics.data_v1beta.services.beta_analytics_data.transports import (
        BetaAnalyticsDataGrpcTransport,
    )

    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    channel = grpc.insecure_channel(f"127.0.0.1:{port}")
    return BetaAnalyticsDataClient(transport=BetaAnalyticsDataGrpcTransport(channel=channel))


_FETCH_BREAKERS: dict[str, Callable[..., object]] = {
    "step_exception": _raise_secret,
    "thread_exception": _raise_in_thread,
    "sys_exit_message": _exit_with_message,
    "noisy_logger": _log_and_raise,
}


def _install(name: str, cli: types.ModuleType) -> None:
    """偽物を差し込む。出力を塞いだ後に呼ばれる。"""
    import google.api_core.exceptions as google_api
    import httpx
    import respx

    from support import batch_scenario as scenario
    from support.fake_ga4 import FakeGa4
    from takatsu_batch import derive, ga4_client, wp_fetch

    # 待ち時間を省く（設定値は単体テストで確かめている）
    vars(wp_fetch)["WP_REQUEST_INTERVAL_MS"] = 0
    for constant in (
        "GA4_REQUEST_INTERVAL_MS",
        "GA4_QUOTA_RETRY_WAIT_SECONDS",
        "GA4_SERVER_ERROR_RETRY_WAIT_SECONDS",
    ):
        vars(ga4_client)[constant] = 0

    wp = scenario.build_wp()
    if name == "validation_error":
        wp.posts.append({**wp.posts[0], "id": SECRET})
    side_effects: dict[str, list[Exception | None]] = {}
    if name == "ga4_exception":
        # Google の例外のコンストラクタには型注釈がないので、型を経由して作る
        invalid_argument: type[Exception] = google_api.InvalidArgument
        side_effects["G1"] = [invalid_argument(f"properties/{scenario.PROPERTY_ID} is not valid")]
    ga4 = FakeGa4(scenario.ga4_responses(), side_effects=side_effects)

    router = respx.mock(assert_all_called=False)
    router.start()
    wp.install(router)
    hook = router.post(scenario.HOOK_URL)
    if name == "hook_exception":
        hook.mock(side_effect=httpx.ConnectError(f"cannot reach {scenario.HOOK_URL}"))
    else:
        hook.mock(return_value=httpx.Response(201, json={"job": {"id": "fake-job"}}))

    vars(cli)["_create_ga4_client"] = (
        _closed_port_client if name == "grpc_closed_port" else lambda: ga4
    )
    if name in _FETCH_BREAKERS:
        vars(wp_fetch)["fetch"] = _FETCH_BREAKERS[name]
    if name == "constraint_violation":
        original = derive.derive

        def broken_derive(*args: Any, **kwargs: Any) -> derive.DeriveOutput:
            output = original(*args, **kwargs)
            # not null 制約に違反する行。エラーの詳細に行の値（Failing row contains）が入る
            output.site_daily.append((date(2026, 1, 1), None, 0))
            return output

        vars(derive)["derive"] = broken_derive


class _FailingFinder(importlib.abc.MetaPathFinder):
    """本体の import の途中で例外を起こす（フックの登録より後の遅延 import）。"""

    def find_spec(
        self,
        fullname: str,
        path: Sequence[str] | None,
        target: types.ModuleType | None = None,
    ) -> ModuleSpec | None:
        if fullname == _CLI:
            raise RuntimeError(SECRET)
        return None


def _stub_cli(name: str) -> types.ModuleType:
    """本物の cli を、出力を塞いだ後で読み込んでから偽物を差し込む代理。"""
    stub = types.ModuleType(_CLI)

    def dispatch(argv: Sequence[str]) -> int:
        del sys.modules[_CLI]
        cli = importlib.import_module(_CLI)
        _install(name, cli)
        code: int = cli.dispatch(argv)
        return code

    vars(stub)["dispatch"] = dispatch
    return stub


def main() -> None:
    name = sys.argv[1]
    if name == "import_error":
        sys.meta_path.insert(0, _FailingFinder())
    else:
        sys.modules[_CLI] = _stub_cli(name)
    sys.argv = ["takatsu_batch", "daily"]
    runpy.run_module("takatsu_batch", run_name="__main__", alter_sys=True)


if __name__ == "__main__":
    main()
