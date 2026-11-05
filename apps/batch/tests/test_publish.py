"""I-B-09 の単体部分: Deploy Hook の呼び出し（03 §8、ADR 0006、NFR-11）。

Vercel は respx で固定する。Hook の URL は架空で、本物には 1 回も送らない。
成功時だけ呼ぶこと、publish_only、実行ログの検査は結合テスト（I-B-09）で確かめる。
"""

import httpx
import pytest
import respx
from pydantic import SecretStr

from takatsu_batch.errors import classify_error
from takatsu_batch.publish import call_deploy_hook

HOOK_URL = "https://api.vercel.example/v1/integrations/deploy/prj_fake/fakeHookToken"


@pytest.mark.parametrize("status", [200, 201, 202])
def test_call_deploy_hook_posts_exactly_once(status: int) -> None:
    with respx.mock(assert_all_called=False) as router:
        router.route().mock(return_value=httpx.Response(status, json={"job": {"id": "fake"}}))
        with httpx.Client() as http:
            call_deploy_hook(http, SecretStr(HOOK_URL))
        requests = [call.request for call in router.calls]
    assert [(request.method, str(request.url)) for request in requests] == [("POST", HOOK_URL)]
    # 本文を送らない
    assert requests[0].content == b""


def test_call_deploy_hook_sets_a_timeout() -> None:
    """クライアントの既定が無制限でも、Hook の呼び出しには上限が付く。"""
    with respx.mock(assert_all_called=False) as router:
        router.route().mock(return_value=httpx.Response(201))
        with httpx.Client(timeout=httpx.Timeout(None)) as http:
            call_deploy_hook(http, SecretStr(HOOK_URL))
        timeout = router.calls.last.request.extensions["timeout"]
    assert all(value is not None for value in timeout.values())


@pytest.mark.parametrize("status", [301, 302, 400, 401, 403, 404, 429, 500, 502, 503])
def test_call_deploy_hook_raises_on_failure_without_retry(status: int) -> None:
    with respx.mock(assert_all_called=False) as router:
        router.route().mock(
            return_value=httpx.Response(status, headers={"Location": "https://evil.example/"})
        )
        with httpx.Client() as http, pytest.raises(httpx.HTTPStatusError) as excinfo:
            call_deploy_hook(http, SecretStr(HOOK_URL))
        requests = [call.request for call in router.calls]
    # 再試行も、転送先への追従も、GET もない
    assert [(request.method, str(request.url)) for request in requests] == [("POST", HOOK_URL)]
    assert classify_error(excinfo.value) == "network"


@pytest.mark.parametrize(
    "error",
    [httpx.ConnectError("偽の接続失敗"), httpx.ReadTimeout("偽のタイムアウト")],
    ids=["connect-error", "read-timeout"],
)
def test_call_deploy_hook_does_not_retry_transport_error(error: httpx.TransportError) -> None:
    with respx.mock(assert_all_called=False) as router:
        router.route().mock(side_effect=error)
        with httpx.Client() as http, pytest.raises(type(error)) as excinfo:
            call_deploy_hook(http, SecretStr(HOOK_URL))
        assert len(router.calls) == 1
    assert classify_error(excinfo.value) == "network"
