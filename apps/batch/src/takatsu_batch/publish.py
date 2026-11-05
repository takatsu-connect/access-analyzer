"""BI の再ビルドの起動（03 §8、ADR 0006）。URL と応答をログに出さない。応答本文を読まない。"""

from typing import Final

import httpx
from pydantic import SecretStr

_HOOK_TIMEOUT_SECONDS: Final = 30.0


def call_deploy_hook(http: httpx.Client, hook_url: SecretStr) -> None:
    """Deploy Hook を 1 回だけ POST する。失敗は httpx の例外（種別 network）。"""
    with http.stream(
        "POST", hook_url.get_secret_value(), timeout=_HOOK_TIMEOUT_SECONDS
    ) as response:
        response.raise_for_status()
