"""中継経由の WP 取得と、中継の設定の検証（ADR 0011 §2、§6）。

実サイトと実際の中継には接続しない。httpx は respx で固定する。値はすべて架空。
"""

import json
import traceback
from collections.abc import Callable
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl

import httpx
import pydantic
import pytest
import respx
from pydantic import SecretStr

from takatsu_batch.config import WP_MAX_RETRIES, WP_USER_AGENT
from takatsu_batch.db import PriorState
from takatsu_batch.env import WpRelayTarget, load_batch_env
from takatsu_batch.errors import BatchValidationError
from takatsu_batch.wp_fetch import WpClient, fetch

SITE = "https://takatsu-connect.com"
RELAY = "https://relay.example"
RELAY_ENDPOINT = f"{RELAY}/api/relay"
TOKEN = "fake-relay-token-".ljust(64, "0")
LAST_SUCCESS = datetime(2026, 11, 3, 18, 30, 15, tzinfo=UTC)
WEEKDAY = date(2026, 11, 4)
SUNDAY = date(2026, 11, 8)
REQUESTS_CONTRACT = Path(__file__).resolve().parents[3] / "contracts" / "wp_relay_requests.json"

ENVIRON = {
    "SUPABASE_BATCH_DB_URL": "postgresql://user:pw-fake@db.pooler.example:5432/postgres",
    "GA4_PROPERTY_ID": "987650123",
    "VERCEL_DEPLOY_HOOK_URL": "https://api.vercel.com/v1/integrations/deploy/prj_fake/hook",
}


class FakeTime:
    """待った分だけ時計が進む。再試行の待ちのあとは、間隔の待ちが足されない。"""

    def __init__(self) -> None:
        self.now = 1000.0
        self.sleeps: list[float] = []

    def clock(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += seconds


def _relay_target() -> WpRelayTarget:
    return WpRelayTarget(url=SecretStr(RELAY), token=SecretStr(TOKEN))


def _prior(last_success: datetime | None) -> PriorState:
    return PriorState(
        last_success_started_at=last_success,
        posts={},
        authors={},
        post_categories=frozenset(),
        post_tags=frozenset(),
        confirmed_months=frozenset(),
        referrer_months=frozenset(),
        city_months=frozenset(),
        referrer_computed={},
    )


def _list_response(items: list[dict[str, Any]]) -> httpx.Response:
    return httpx.Response(200, json=items, headers={"X-WP-TotalPages": "1"})


def _call_client(
    handler: Callable[[httpx.Request], httpx.Response],
    relay: WpRelayTarget | None,
    time: FakeTime | None = None,
) -> httpx.Response:
    clock = time or FakeTime()
    with respx.mock(assert_all_called=False) as router, httpx.Client() as http:
        router.route().mock(side_effect=handler)
        client = WpClient(http, clock.sleep, clock.clock, relay=relay)
        return client.get("/users/7", {"_fields": "name,slug,link"})


# --- 送り方 ---


def test_relay_request_goes_to_relay_with_path_and_token() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={})

    _call_client(handler, _relay_target())
    request = seen[0]
    assert str(request.url.copy_with(query=None)) == RELAY_ENDPOINT
    assert request.headers["X-WP-Path"] == "/users/7"
    assert request.headers["Authorization"] == f"Bearer {TOKEN}"
    assert request.headers["User-Agent"] == WP_USER_AGENT
    assert dict(request.url.params) == {"_fields": "name,slug,link"}


def test_direct_request_has_no_relay_headers() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={})

    _call_client(handler, None)
    request = seen[0]
    assert str(request.url.copy_with(query=None)) == f"{SITE}/wp-json/wp/v2/users/7"
    assert "X-WP-Path" not in request.headers
    assert "Authorization" not in request.headers


# --- 再試行と失敗 ---


@pytest.mark.parametrize("status", [429, 500, 502, 503, 504])
def test_relay_retries_like_direct(status: int) -> None:
    time = FakeTime()
    calls: list[int] = []

    def handler(_request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(status if len(calls) <= WP_MAX_RETRIES else 200, json={})

    response = _call_client(handler, _relay_target(), time)
    assert response.status_code == 200
    assert len(calls) == WP_MAX_RETRIES + 1
    assert time.sleeps == [1.0, 2.0, 4.0]


@pytest.mark.parametrize("status", [301, 400, 401, 403, 404, 413])
def test_relay_does_not_retry_permanent_failures_and_hides_token(status: int) -> None:
    calls: list[int] = []

    def handler(_request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(status)

    with pytest.raises(httpx.HTTPStatusError) as excinfo:
        _call_client(handler, _relay_target())
    assert len(calls) == 1
    assert TOKEN not in "".join(traceback.format_exception(excinfo.value))


def test_transport_error_does_not_expose_token() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("boom")

    with pytest.raises(httpx.ConnectError) as excinfo:
        _call_client(handler, _relay_target())
    assert TOKEN not in "".join(traceback.format_exception(excinfo.value))


# --- ADR 0011 §2 の 8 種（中継側は apps/wp-relay/tests が同じ JSON を通す） ---


def test_batch_sends_exactly_the_requests_listed_in_the_contract() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        path = request.headers["X-WP-Path"]
        params = request.url.params
        if path == "/users/7":
            return httpx.Response(
                200, json={"name": "書き手", "slug": "author-a", "link": f"{SITE}/author/a/"}
            )
        if path != "/posts":
            return _list_response([])
        fields = params["_fields"]
        if "date_gmt" not in fields:
            return _list_response([{"id": 1, "author": 7}, {"id": 2}, {"id": 3}])
        wanted = params.get("include")
        ids = [int(value) for value in wanted.split(",")] if wanted else [1]
        return _list_response(
            [
                {
                    "id": post_id,
                    "date_gmt": "2026-10-01T03:00:00",
                    "modified_gmt": "2026-10-02T04:00:00",
                    "link": f"{SITE}/{post_id}/",
                    "title": {"rendered": "記事"},
                    "author": 7,
                    "categories": [],
                    "tags": [],
                    "content": {"protected": False},
                }
                for post_id in ids
            ]
        )

    time = FakeTime()
    with respx.mock(assert_all_called=False) as router, httpx.Client() as http:
        router.route().mock(side_effect=handler)
        for base_date, prior, full in (
            (WEEKDAY, _prior(None), True),
            (SUNDAY, _prior(LAST_SUCCESS), False),
        ):
            client = WpClient(http, time.sleep, time.clock, relay=_relay_target())
            fetch(client, prior, base_date, full=full)

    def key(path: str, query: dict[str, str]) -> tuple[str, tuple[tuple[str, str], ...]]:
        return path, tuple(sorted(query.items()))

    actual = {
        key(
            request.headers["X-WP-Path"],
            dict(parse_qsl(request.url.query.decode(), keep_blank_values=True)),
        )
        for request in seen
    }
    contract = json.loads(REQUESTS_CONTRACT.read_text(encoding="utf-8"))
    assert actual == {key(item["path"], item["query"]) for item in contract}
    assert len(contract) == 8


# --- 環境変数 ---


def _environ(**extra: str) -> dict[str, str]:
    return {**ENVIRON, **extra}


def _load_relay(url: str, token: str = TOKEN) -> WpRelayTarget | None:
    return load_batch_env(_environ(WP_RELAY_URL=url, WP_RELAY_TOKEN=token)).wp_relay


def test_relay_is_none_when_both_are_unset() -> None:
    assert load_batch_env(_environ()).wp_relay is None


def test_relay_is_none_when_both_are_empty() -> None:
    assert load_batch_env(_environ(WP_RELAY_URL="", WP_RELAY_TOKEN="")).wp_relay is None


@pytest.mark.parametrize(
    "extra",
    [
        {"WP_RELAY_URL": RELAY},
        {"WP_RELAY_TOKEN": TOKEN},
        {"WP_RELAY_URL": RELAY, "WP_RELAY_TOKEN": ""},
        {"WP_RELAY_URL": "", "WP_RELAY_TOKEN": TOKEN},
    ],
    ids=["url-only", "token-only", "token-empty", "url-empty"],
)
def test_relay_with_only_one_value_stops(extra: dict[str, str]) -> None:
    with pytest.raises(BatchValidationError) as excinfo:
        load_batch_env(_environ(**extra))
    assert excinfo.value.args == ()
    assert TOKEN not in str(excinfo.value)


@pytest.mark.parametrize(
    "url",
    [
        RELAY,
        "https://relay.example:8443",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost",
        "https://localhost",
    ],
)
def test_relay_accepts_origin(url: str) -> None:
    relay = _load_relay(url)
    assert relay is not None
    assert relay.url.get_secret_value() == url
    assert relay.token.get_secret_value() == TOKEN


@pytest.mark.parametrize(
    "url",
    [
        "http://relay.example",
        "http://localhost.example.com",
        "http://localhost.evil.example:3000",
        "http://127.0.0.1.evil.example",
        "http://127.0.0.2:3000",
        "ftp://relay.example",
        "HTTPS://relay.example",
        "relay.example",
        "https://",
        "https://user:pw@relay.example",
        "https://user@relay.example",
        "https://relay.example/",
        "https://relay.example/api/relay",
        "https://relay.example?x=1",
        "https://relay.example?",
        "https://relay.example#f",
        "https://relay.example#",
        "https://relay.example:99999",
        "https://relay.example:port",
        " https://relay.example",
        "https://relay.example ",
        "https://rel\nay.example",
        "https://relay.example\n",
        "https://evil.example\\@relay.example",
    ],
)
def test_relay_rejects_url_without_exposing_value(url: str) -> None:
    with pytest.raises(BatchValidationError) as excinfo:
        _load_relay(url)
    assert excinfo.value.args == ()
    assert "relay.example" not in "".join(traceback.format_exception(excinfo.value))


@pytest.mark.parametrize(
    "prefix", ["has space", "new\nline", "トークン", "tab\tin"], ids=["space", "lf", "jp", "tab"]
)
def test_relay_rejects_token_that_cannot_be_a_header(prefix: str) -> None:
    # 長さの下限ではなく文字の検査で止まることを確かめるため、64 文字以上にする
    token = prefix.ljust(64, "a")
    with pytest.raises(BatchValidationError) as excinfo:
        _load_relay(RELAY, token)
    assert token not in "".join(traceback.format_exception(excinfo.value))


def test_relay_rejects_token_shorter_than_64() -> None:
    token = "a" * 63
    with pytest.raises(BatchValidationError) as excinfo:
        _load_relay(RELAY, token)
    assert excinfo.value.args == ()
    assert token not in "".join(traceback.format_exception(excinfo.value))


def test_relay_accepts_token_of_exactly_64() -> None:
    relay = _load_relay(RELAY, "a" * 64)
    assert relay is not None


def test_relay_values_are_hidden_in_repr_and_dump() -> None:
    env = load_batch_env(_environ(WP_RELAY_URL=RELAY, WP_RELAY_TOKEN=TOKEN))
    for text in (repr(env), str(env), env.model_dump_json()):
        assert TOKEN not in text
        assert "relay.example" not in text


def test_relay_missing_required_variable_does_not_expose_token() -> None:
    environ = _environ(WP_RELAY_URL=RELAY, WP_RELAY_TOKEN=TOKEN)
    del environ["GA4_PROPERTY_ID"]
    with pytest.raises(pydantic.ValidationError) as excinfo:
        load_batch_env(environ)
    assert TOKEN not in str(excinfo.value)
