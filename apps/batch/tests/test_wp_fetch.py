"""U-23 と wp_fetch の挙動（03 §4、NFR-34、NFR-35、NFR-72、FR-04、FR-72、NFR-91）。

WP REST API は respx で固定する。本物の対象サイトには 1 回も送らない。
時計と sleep は偽物に替え、待った秒数を記録するだけにする。フィクスチャはすべて架空の値。
"""

import re
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from typing import Any

import httpx
import pydantic
import pytest
import respx

from takatsu_batch import tz
from takatsu_batch.config import AD_CATEGORY_ID, WP_USER_AGENT
from takatsu_batch.db import AuthorRow, PostRow, PriorState
from takatsu_batch.errors import BatchValidationError
from takatsu_batch.wp_fetch import CategoryRow, WpClient, WpResult, ad_category_ids, fetch

SITE = "https://takatsu-connect.com"
API_PATH = "/wp-json/wp/v2"
API = f"{SITE}{API_PATH}"
SUNDAY = date(2026, 11, 1)
WEEKDAY = date(2026, 11, 4)  # 水曜
LAST_SUCCESS = datetime(2026, 11, 3, 18, 30, 15, tzinfo=UTC)
FIRST_SEEN = date(2026, 9, 1)
POST_FIELDS = (
    "id,date_gmt,modified_gmt,link,title.rendered,author,categories,tags,content.protected"
)
ALLOWED_PARAMS = {"_fields", "status", "modified_after", "per_page", "page"}


class FakeTime:
    """偽の時計と sleep。sleep_advances=True なら、待った分だけ時計が進む。"""

    def __init__(self, *, sleep_advances: bool = False) -> None:
        self.now = 1000.0
        self.sleeps: list[float] = []
        self._sleep_advances = sleep_advances

    def clock(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        if self._sleep_advances:
            self.now += seconds


def _wp_category(category_id: int, name: str, parent: int = 0) -> dict[str, Any]:
    return {"id": category_id, "name": name, "parent": parent}


def _wp_tag(tag_id: int, name: str) -> dict[str, Any]:
    return {"id": tag_id, "name": name}


def _wp_user(slug: str, name: str, link: str | None = None) -> dict[str, Any]:
    return {"name": name, "slug": slug, "link": link or f"{SITE}/author/{slug}/"}


def _wp_post(
    post_id: int,
    *,
    title: str = "記事",
    author: int = 7,
    categories: Sequence[int] = (10,),
    tags: Sequence[int] = (20,),
    protected: bool = False,
    date_gmt: str = "2026-10-01T03:00:00",
    modified_gmt: str = "2026-10-02T04:00:00",
    link: str | None = None,
) -> dict[str, Any]:
    return {
        "id": post_id,
        "date_gmt": date_gmt,
        "modified_gmt": modified_gmt,
        "link": link or f"{SITE}/{post_id}/",
        "title": {"rendered": title},
        "author": author,
        "categories": list(categories),
        "tags": list(tags),
        "content": {"protected": protected},
    }


def _row(
    post_id: int,
    *,
    title: str = "記事",
    author_slug: str = "author-a",
    is_ad: bool = False,
    first_seen_on: date = FIRST_SEEN,
) -> PostRow:
    """_wp_post の既定値と同じ内容の、前回の行。"""
    return PostRow(
        post_id=post_id,
        title=title,
        post_url=f"{SITE}/{post_id}/",
        author_slug=author_slug,
        published_at=datetime(2026, 10, 1, 3, 0, tzinfo=UTC),
        published_on=date(2026, 10, 1),
        modified_at=datetime(2026, 10, 2, 4, 0, tzinfo=UTC),
        is_ad=is_ad,
        first_seen_on=first_seen_on,
    )


def _author(
    slug: str = "author-a", name: str = "書き手A", first_seen_on: date = FIRST_SEEN
) -> AuthorRow:
    return AuthorRow(slug, name, f"{SITE}/author/{slug}/", first_seen_on)


def _prior(
    *,
    last_success: datetime | None = LAST_SUCCESS,
    posts: Sequence[PostRow] = (),
    authors: Sequence[AuthorRow] = (),
    post_categories: Sequence[tuple[int, int]] | frozenset[tuple[int, int]] = (),
    post_tags: Sequence[tuple[int, int]] | frozenset[tuple[int, int]] = (),
) -> PriorState:
    return PriorState(
        last_success_started_at=last_success,
        posts={row.post_id: row for row in posts},
        authors={row.author_slug: row for row in authors},
        post_categories=frozenset(post_categories),
        post_tags=frozenset(post_tags),
        confirmed_months=frozenset(),
        referrer_months=frozenset(),
        city_months=frozenset(),
        referrer_computed={},
    )


def _default_users() -> dict[int, dict[str, Any]]:
    return {
        7: _wp_user("author-a", "書き手A"),
        8: _wp_user("author-b", "書き手B"),
        9: _wp_user("author-c", "書き手C"),
    }


@dataclass
class FakeSite:
    """WP REST API の偽物。受けたリクエストを requests に残す。

    detail は記事の詳細（_fields に date_gmt を含む問い合わせ）への応答、
    live は公開中の記事の (id, author)。None なら detail から作る。
    by_id は ID を指定した取得（include）で返せる記事。
    """

    categories: list[dict[str, Any]] = field(default_factory=lambda: [_wp_category(10, "地域")])
    tags: list[dict[str, Any]] = field(default_factory=lambda: [_wp_tag(20, "催し")])
    detail: list[dict[str, Any]] = field(default_factory=list)
    live: list[tuple[int, int]] | None = None
    by_id: list[dict[str, Any]] = field(default_factory=list)
    # ID 一覧の応答に付ける X-WP-Total。None なら付けない
    id_total: int | None = None
    users: dict[int, dict[str, Any]] = field(default_factory=_default_users)
    page_size: int = 100
    requests: list[httpx.Request] = field(default_factory=list)

    def _live(self) -> list[dict[str, Any]]:
        pairs = self.live
        if pairs is None:
            pairs = [(post["id"], post["author"]) for post in self.detail]
        return [{"id": post_id, "author": author} for post_id, author in pairs]

    def _page(self, items: Sequence[dict[str, Any]], request: httpx.Request) -> httpx.Response:
        page = int(request.url.params["page"])
        start = (page - 1) * self.page_size
        total = -(-len(items) // self.page_size)  # 0 件のときは 0 ページ（ゼロ件の境界）
        return httpx.Response(
            200,
            json=list(items[start : start + self.page_size]),
            headers={"X-WP-TotalPages": str(total)},
        )

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        path = request.url.path.removeprefix(API_PATH)
        if path == "/categories":
            return self._page(self.categories, request)
        if path == "/tags":
            return self._page(self.tags, request)
        if path == "/posts":
            fields = str(request.url.params.get("_fields", "")).split(",")
            if "date_gmt" in fields:
                include = request.url.params.get("include")
                if include is not None:
                    wanted = {int(value) for value in include.split(",")}
                    return self._page(
                        [post for post in self.by_id if post["id"] in wanted], request
                    )
                return self._page(self.detail, request)
            # ID 一覧は、求められたフィールドだけを返す（平日は author を返さない）
            response = self._page(
                [{key: item[key] for key in fields} for item in self._live()], request
            )
            if self.id_total is not None:
                response.headers["X-WP-Total"] = str(self.id_total)
            return response
        matched = re.fullmatch(r"/users/(\d+)", path)
        if matched and int(matched[1]) in self.users:
            return httpx.Response(200, json=self.users[int(matched[1])])
        return httpx.Response(404, json={"code": "rest_no_route"})

    def paths(self) -> list[str]:
        return [request.url.path.removeprefix(API_PATH) for request in self.requests]

    def id_list_requests(self) -> list[httpx.Request]:
        return [
            request
            for request in self.requests
            if request.url.path == f"{API_PATH}/posts"
            and "date_gmt" not in request.url.params["_fields"]
        ]

    def detail_requests(self) -> list[httpx.Request]:
        return [
            request
            for request in self.requests
            if request.url.path == f"{API_PATH}/posts"
            and "date_gmt" in request.url.params["_fields"]
        ]


def _run(
    site: FakeSite,
    prior: PriorState,
    base_date: date = WEEKDAY,
    *,
    full: bool = False,
    time: FakeTime | None = None,
) -> WpResult:
    fake = time or FakeTime()
    with respx.mock(assert_all_called=False) as router:
        router.route().mock(side_effect=site.handle)
        with httpx.Client() as http:
            return fetch(WpClient(http, fake.sleep, fake.clock), prior, base_date, full=full)


@contextmanager
def _mocked_client(fake: FakeTime) -> Iterator[tuple[respx.MockRouter, WpClient]]:
    with respx.mock(assert_all_called=False) as router, httpx.Client() as http:
        yield router, WpClient(http, fake.sleep, fake.clock)


def _busy_site() -> FakeSite:
    """更新 2 本、パスワード付き 1 本、差分に出ない公開中 1 本。"""
    return FakeSite(
        categories=[
            _wp_category(10, "地域"),
            _wp_category(AD_CATEGORY_ID, "広告"),
            _wp_category(30, "お知らせ", parent=AD_CATEGORY_ID),
        ],
        tags=[_wp_tag(20, "催し"), _wp_tag(21, "散歩")],
        detail=[
            _wp_post(101, title="更新された記事"),
            _wp_post(102, author=8, categories=[30], tags=[21]),
            _wp_post(103, author=9, protected=True),
        ],
        live=[(101, 7), (102, 8), (103, 9), (104, 8)],
    )


def _busy_prior(last_success: datetime | None) -> PriorState:
    return _prior(
        last_success=last_success,
        posts=[_row(101), _row(104, author_slug="author-b"), _row(105)],
        authors=[_author(), _author("author-b", "書き手B")],
        post_categories=[(101, 10), (104, 10), (105, 10)],
        post_tags=[(101, 20), (105, 20)],
    )


def _assert_public_scope(requests: Sequence[httpx.Request]) -> None:
    """U-23: 公開範囲の外に出る問い合わせが 1 つもない。"""
    assert requests
    for request in requests:
        path = request.url.path
        params = request.url.params
        fields = set(params["_fields"].split(","))
        assert request.method == "GET"
        assert str(request.url).startswith(f"{API}/")
        # 03 §4 の表にある 4 種類だけ。comments、pages、users の一覧を呼ばない
        assert re.fullmatch(rf"{API_PATH}/(categories|tags|posts|users/\d+)", path)
        assert "/comments" not in path
        assert set(params.keys()) <= ALLOWED_PARAMS
        assert params.get_list("status") in ([], ["publish"])
        assert request.headers["User-Agent"] == WP_USER_AGENT
        # 認証を付けると非公開の範囲が見えてしまう
        assert "Authorization" not in request.headers
        assert "Cookie" not in request.headers
        assert not any("email" in name for name in fields)
        if path == f"{API_PATH}/posts":
            assert params.get_list("status") == ["publish"]
            assert fields <= set(POST_FIELDS.split(","))
        if "/users/" in path:
            assert params["_fields"] == "name,slug,link"


# --- フィクスチャの前提 ---


def test_fixture_weekdays() -> None:
    assert SUNDAY.weekday() == 6
    assert WEEKDAY.weekday() == 2


# --- WpClient: 間隔（NFR-72） ---


def test_first_request_does_not_sleep() -> None:
    fake = FakeTime()
    with _mocked_client(fake) as (router, client):
        router.route().mock(return_value=httpx.Response(200, json=[]))
        client.get("/tags", {"_fields": "id,name"})
    assert fake.sleeps == []
    assert client.requests == 1


def test_interval_is_one_second_per_request_when_clock_does_not_advance() -> None:
    fake = FakeTime()
    with _mocked_client(fake) as (router, client):
        router.route().mock(return_value=httpx.Response(200, json=[]))
        for _ in range(4):
            client.get("/tags", {"_fields": "id,name"})
    assert fake.sleeps == [1.0, 1.0, 1.0]


@pytest.mark.parametrize(
    ("elapsed", "expected_sleeps"),
    [
        (0.0, [1.0]),
        (0.25, [0.75]),
        (0.75, [0.25]),
        (1.0, []),
        (5.0, []),
    ],
)
def test_interval_sleeps_only_the_shortfall(elapsed: float, expected_sleeps: list[float]) -> None:
    fake = FakeTime()
    with _mocked_client(fake) as (router, client):
        router.route().mock(return_value=httpx.Response(200, json=[]))
        client.get("/tags", {"_fields": "id,name"})
        fake.now += elapsed
        client.get("/tags", {"_fields": "id,name"})
    assert fake.sleeps == expected_sleeps


def test_request_carries_user_agent_and_params() -> None:
    with _mocked_client(FakeTime()) as (router, client):
        route = router.route().mock(return_value=httpx.Response(200, json=[]))
        client.get("/tags", {"_fields": "id,name"})
        request = route.calls.last.request
    assert str(request.url) == f"{API}/tags?_fields=id%2Cname"
    assert request.headers["User-Agent"] == WP_USER_AGENT


# --- WpClient: 再試行（03 §4） ---


@pytest.mark.parametrize("status", [429, 500, 502, 503, 504])
def test_retry_backs_off_1_2_4_seconds_then_raises(status: int) -> None:
    fake = FakeTime(sleep_advances=True)
    with _mocked_client(fake) as (router, client):
        route = router.route().mock(return_value=httpx.Response(status))
        with pytest.raises(httpx.HTTPStatusError):
            client.get("/tags", {"_fields": "id,name"})
        assert route.call_count == 4
    # 待った分だけ時計が進むので、間隔のための sleep は足されない
    assert fake.sleeps == [1.0, 2.0, 4.0]
    assert client.requests == 4


def test_retry_also_keeps_interval_when_clock_does_not_advance() -> None:
    fake = FakeTime()
    with _mocked_client(fake) as (router, client):
        router.route().mock(return_value=httpx.Response(503))
        with pytest.raises(httpx.HTTPStatusError):
            client.get("/tags", {"_fields": "id,name"})
    # バックオフ 1, 2, 4 のそれぞれのあとに、間隔の 1 秒が入る
    assert fake.sleeps == [1.0, 1.0, 2.0, 1.0, 4.0, 1.0]


@pytest.mark.parametrize(
    "error",
    [httpx.ConnectError("偽の接続失敗"), httpx.ReadTimeout("偽のタイムアウト")],
    ids=["connect-error", "read-timeout"],
)
def test_retry_on_transport_error_then_raises_the_same_error(error: httpx.TransportError) -> None:
    fake = FakeTime(sleep_advances=True)
    with _mocked_client(fake) as (router, client):
        route = router.route().mock(side_effect=error)
        with pytest.raises(type(error)):
            client.get("/tags", {"_fields": "id,name"})
        assert route.call_count == 4
    assert fake.sleeps == [1.0, 2.0, 4.0]


def test_retry_recovers_after_failures() -> None:
    fake = FakeTime(sleep_advances=True)
    with _mocked_client(fake) as (router, client):
        route = router.route().mock(
            side_effect=[
                httpx.Response(503),
                httpx.ConnectError("偽の接続失敗"),
                httpx.Response(200, json=[{"id": 20, "name": "催し"}]),
            ]
        )
        response = client.get("/tags", {"_fields": "id,name"})
        assert route.call_count == 3
    assert response.status_code == 200
    assert fake.sleeps == [1.0, 2.0]
    assert client.requests == 3


@pytest.mark.parametrize("status", [400, 401, 403, 404])
def test_client_error_is_not_retried(status: int) -> None:
    fake = FakeTime()
    with _mocked_client(fake) as (router, client):
        route = router.route().mock(return_value=httpx.Response(status))
        with pytest.raises(httpx.HTTPStatusError):
            client.get("/tags", {"_fields": "id,name"})
        assert route.call_count == 1
    assert fake.sleeps == []


def test_redirect_is_not_followed() -> None:
    """対象サイトの外へ転送されても追わない（NFR-91）。"""
    with _mocked_client(FakeTime()) as (router, client):
        router.route().mock(
            return_value=httpx.Response(301, headers={"Location": "https://evil.example/tags"})
        )
        with pytest.raises(httpx.HTTPStatusError):
            client.get("/tags", {"_fields": "id,name"})
        hosts = [call.request.url.host for call in router.calls]
    assert hosts == ["takatsu-connect.com"]


# --- WpClient: ページング ---


def test_get_pages_follows_total_pages_header() -> None:
    def respond(request: httpx.Request) -> httpx.Response:
        page = request.url.params["page"]
        return httpx.Response(200, json=[{"id": int(page)}], headers={"X-WP-TotalPages": "2"})

    with _mocked_client(FakeTime()) as (router, client):
        router.route().mock(side_effect=respond)
        bodies = client.get_pages("/posts", {"status": "publish", "_fields": "id"})
        seen = [dict(call.request.url.params) for call in router.calls]
    assert bodies == [b'[{"id":1}]', b'[{"id":2}]']
    assert seen == [
        {"status": "publish", "_fields": "id", "per_page": "100", "page": "1"},
        {"status": "publish", "_fields": "id", "per_page": "100", "page": "2"},
    ]


@pytest.mark.parametrize(("total_pages", "expected_requests"), [("0", 1), ("1", 1), ("50", 50)])
def test_get_pages_accepts_total_pages_up_to_limit(
    total_pages: str, expected_requests: int
) -> None:
    with _mocked_client(FakeTime()) as (router, client):
        route = router.route().mock(
            return_value=httpx.Response(200, json=[], headers={"X-WP-TotalPages": total_pages})
        )
        bodies = client.get_pages("/posts", {"status": "publish", "_fields": "id"})
        assert route.call_count == expected_requests
    assert len(bodies) == expected_requests


@pytest.mark.parametrize(
    "header",
    [None, b"", b"abc", b"-1", b"1.5", b"51", "２".encode()],
    ids=["missing", "empty", "letters", "negative", "decimal", "over-limit", "fullwidth-digit"],
)
def test_get_pages_rejects_invalid_total_pages(header: bytes | None) -> None:
    headers = [] if header is None else [(b"X-WP-TotalPages", header)]
    with _mocked_client(FakeTime()) as (router, client):
        route = router.route().mock(return_value=httpx.Response(200, json=[], headers=headers))
        with pytest.raises(BatchValidationError):
            client.get_pages("/posts", {"status": "publish", "_fields": "id"})
        assert route.call_count == 1


# --- U-23: リクエストの組み立て ---


@pytest.mark.parametrize(
    ("base_date", "full", "last_success"),
    [
        pytest.param(WEEKDAY, False, LAST_SUCCESS, id="daily"),
        pytest.param(SUNDAY, False, LAST_SUCCESS, id="weekly"),
        pytest.param(WEEKDAY, True, LAST_SUCCESS, id="full"),
        pytest.param(SUNDAY, True, LAST_SUCCESS, id="full-weekly"),
        pytest.param(WEEKDAY, False, None, id="first-run"),
    ],
)
def test_u23_requests_stay_in_public_scope(
    base_date: date, full: bool, last_success: datetime | None
) -> None:
    site = _busy_site()
    result = _run(site, _busy_prior(last_success), base_date, full=full)
    _assert_public_scope(site.requests)
    assert result.requests == len(site.requests)


def test_u23_daily_request_sequence_matches_design_table() -> None:
    """03 §4 の表の 1〜5 の順と中身。"""
    site = _busy_site()
    _run(site, _busy_prior(LAST_SUCCESS), WEEKDAY)
    seen = [
        (request.url.path.removeprefix(API_PATH), dict(request.url.params))
        for request in site.requests
    ]
    paging = {"per_page": "100", "page": "1"}
    assert seen == [
        ("/categories", {"_fields": "id,name,parent", **paging}),
        ("/tags", {"_fields": "id,name", **paging}),
        (
            "/posts",
            {
                "status": "publish",
                "_fields": POST_FIELDS,
                "modified_after": "2026-11-02T18:30:15Z",
                **paging,
            },
        ),
        ("/posts", {"status": "publish", "_fields": "id", **paging}),
        # パスワード付きの記事（著者 9）の著者は問い合わせない
        ("/users/7", {"_fields": "name,slug,link"}),
        ("/users/8", {"_fields": "name,slug,link"}),
    ]


@pytest.mark.parametrize(
    ("last_success", "expected"),
    [
        pytest.param(LAST_SUCCESS, "2026-11-02T18:30:15Z", id="utc"),
        pytest.param(
            datetime(2026, 11, 4, 3, 30, 15, tzinfo=tz.JST), "2026-11-02T18:30:15Z", id="jst-input"
        ),
        pytest.param(
            datetime(2026, 11, 1, 0, 0, 0, tzinfo=UTC), "2026-10-31T00:00:00Z", id="month-start"
        ),
        pytest.param(
            datetime(2027, 1, 1, 0, 30, 0, tzinfo=UTC), "2026-12-31T00:30:00Z", id="new-year"
        ),
        pytest.param(
            datetime(2027, 1, 1, 8, 59, 59, tzinfo=tz.JST),
            "2026-12-30T23:59:59Z",
            id="new-year-jst",
        ),
        pytest.param(
            datetime(2028, 3, 1, 12, 0, 0, tzinfo=UTC), "2028-02-29T12:00:00Z", id="leap-day"
        ),
        pytest.param(
            datetime(2026, 11, 3, 18, 30, 15, 999999, tzinfo=UTC),
            "2026-11-02T18:30:15Z",
            id="microseconds-truncated",
        ),
    ],
)
def test_u23_modified_after_is_last_success_minus_one_day(
    last_success: datetime, expected: str
) -> None:
    site = FakeSite()
    _run(site, _prior(last_success=last_success), WEEKDAY)
    assert [dict(request.url.params).get("modified_after") for request in site.requests] == [
        None,  # categories
        None,  # tags
        expected,  # 差分の記事
        None,  # ID 一覧は常に全件
    ]
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", expected)


@pytest.mark.parametrize(
    ("full", "last_success"),
    [
        pytest.param(True, LAST_SUCCESS, id="full"),
        pytest.param(False, None, id="no-previous-success"),
        pytest.param(True, None, id="full-and-no-previous-success"),
    ],
)
def test_u23_no_modified_after_when_full_or_first_run(
    full: bool, last_success: datetime | None
) -> None:
    site = FakeSite()
    _run(site, _prior(last_success=last_success), WEEKDAY, full=full)
    assert len(site.requests) == 4
    assert all("modified_after" not in request.url.params for request in site.requests)


@pytest.mark.parametrize(
    ("base_date", "expected_fields"),
    [
        pytest.param(SUNDAY, "id,author", id="sunday"),
        pytest.param(WEEKDAY, "id", id="wednesday"),
        pytest.param(SUNDAY - timedelta(days=1), "id", id="saturday"),
        pytest.param(SUNDAY + timedelta(days=1), "id", id="monday"),
        pytest.param(date(2026, 12, 27), "id,author", id="last-sunday-of-year"),
    ],
)
def test_id_list_fields_depend_on_weekday(base_date: date, expected_fields: str) -> None:
    site = _busy_site()
    _run(site, _busy_prior(LAST_SUCCESS), base_date)
    assert [request.url.params["_fields"] for request in site.id_list_requests()] == [
        expected_fields
    ]


def test_fetch_keeps_interval_between_all_requests() -> None:
    fake = FakeTime()
    site = _busy_site()
    result = _run(site, _busy_prior(LAST_SUCCESS), SUNDAY, time=fake)
    assert len(site.requests) > 4
    assert fake.sleeps == [1.0] * (len(site.requests) - 1)
    assert result.requests == len(site.requests)


def test_weekday_without_changes_sends_four_requests_and_no_users() -> None:
    """ゼロ件: 差分が 0 件の日は、カテゴリ、タグ、差分、ID 一覧の 4 回だけ。"""
    site = FakeSite(live=[(101, 7)])
    prior = _prior(
        posts=[_row(101)], authors=[_author()], post_categories=[(101, 10)], post_tags=[(101, 20)]
    )
    result = _run(site, prior)
    assert site.paths() == ["/categories", "/tags", "/posts", "/posts"]
    assert result.posts == prior.posts
    assert result.changed_posts == ()
    assert result.deleted_post_ids == frozenset()
    assert result.authors == prior.authors
    assert result.post_categories == prior.post_categories
    assert result.post_tags == prior.post_tags
    assert result.requests == 4


def test_sunday_fetches_each_author_once() -> None:
    site = FakeSite(live=[(101, 7), (102, 7), (103, 8)])
    prior = _prior(
        posts=[_row(101), _row(102), _row(103, author_slug="author-b")],
        authors=[_author(), _author("author-b", "書き手B")],
    )
    _run(site, prior, SUNDAY)
    assert site.paths()[4:] == ["/users/7", "/users/8"]


def test_empty_site_on_first_run() -> None:
    """ゼロ件: 記事もカテゴリもタグもないサイト。"""
    site = FakeSite(categories=[], tags=[])
    result = _run(site, _prior(last_success=None), full=True)
    assert result.posts == {}
    assert result.changed_posts == ()
    assert result.deleted_post_ids == frozenset()
    assert result.authors == {}
    assert result.categories == ()
    assert result.tags == ()
    assert result.post_categories == frozenset()
    assert result.post_tags == frozenset()


# --- 対象サイトの外へのリンク（FR-04、NFR-91） ---

BAD_LINKS = [
    "https://evil.example/101/",
    "https://takatsu-connect.com.evil.example/101/",
    "https://takatsu-connect.com@evil.example/101/",
    "http://takatsu-connect.com/101/",
    "//takatsu-connect.com/101/",
    "javascript:alert(1)",
    "",
]


@pytest.mark.parametrize("link", BAD_LINKS)
def test_post_link_outside_site_is_rejected(link: str) -> None:
    post = _wp_post(101)
    post["link"] = link
    with pytest.raises(BatchValidationError):
        _run(FakeSite(detail=[post]), _prior())


@pytest.mark.parametrize("link", BAD_LINKS)
def test_author_link_outside_site_is_rejected(link: str) -> None:
    user = _wp_user("author-a", "書き手A")
    user["link"] = link
    with pytest.raises(BatchValidationError):
        _run(FakeSite(detail=[_wp_post(101)], users={7: user}), _prior())


# --- マージ（NFR-34、FR-72） ---


def test_post_missing_from_id_list_is_deleted() -> None:
    site = FakeSite(live=[(101, 7)])
    prior = _prior(
        posts=[_row(101), _row(102)],
        authors=[_author()],
        post_categories=[(101, 10), (102, 10)],
        post_tags=[(101, 20), (102, 20)],
    )
    result = _run(site, prior)
    assert set(result.posts) == {101}
    assert result.deleted_post_ids == frozenset({102})
    assert result.changed_posts == ()
    assert result.post_categories == frozenset({(101, 10)})
    assert result.post_tags == frozenset({(101, 20)})


def test_post_that_became_protected_is_deleted() -> None:
    # パスワード付きにしても status は publish のままなので、ID 一覧には残る
    site = FakeSite(detail=[_wp_post(101, protected=True)], live=[(101, 7), (102, 7)])
    prior = _prior(
        posts=[_row(101), _row(102)],
        authors=[_author()],
        post_categories=[(101, 10), (102, 10)],
        post_tags=[(101, 20)],
    )
    result = _run(site, prior)
    assert set(result.posts) == {102}
    assert result.deleted_post_ids == frozenset({101})
    assert result.changed_posts == ()
    assert result.post_categories == frozenset({(102, 10)})
    assert result.post_tags == frozenset()


def test_new_protected_post_is_never_taken_in() -> None:
    site = FakeSite(detail=[_wp_post(101, author=9, protected=True)])
    result = _run(site, _prior())
    assert result.posts == {}
    assert result.changed_posts == ()
    assert result.deleted_post_ids == frozenset()
    assert result.authors == {}
    assert result.post_categories == frozenset()
    assert not any(path.startswith("/users/") for path in site.paths())


def test_all_posts_deleted() -> None:
    """ゼロ件: 公開中の記事がなくなった。"""
    site = FakeSite(live=[])
    prior = _prior(posts=[_row(101)], authors=[_author()], post_categories=[(101, 10)])
    result = _run(site, prior)
    assert result.posts == {}
    assert result.deleted_post_ids == frozenset({101})
    assert result.authors == {}
    assert result.post_categories == frozenset()


def test_prior_post_outside_diff_is_kept_and_not_changed() -> None:
    site = FakeSite(detail=[_wp_post(102, title="新しい記事")], live=[(101, 7), (102, 7)])
    prior = _prior(posts=[_row(101)], authors=[_author()], post_categories=[(101, 10)])
    result = _run(site, prior)
    assert result.posts[101] == prior.posts[101]
    assert [row.post_id for row in result.changed_posts] == [102]


def test_diff_post_with_same_content_is_not_changed() -> None:
    """再取得: 1 日の重なりで前回と同じ記事がまた来ても、変更として数えない。"""
    site = FakeSite(detail=[_wp_post(101)])
    prior = _prior(
        posts=[_row(101)], authors=[_author()], post_categories=[(101, 10)], post_tags=[(101, 20)]
    )
    result = _run(site, prior)
    assert result.posts == prior.posts
    assert result.changed_posts == ()
    assert result.deleted_post_ids == frozenset()


def test_diff_post_with_new_title_is_changed_and_keeps_first_seen_on() -> None:
    site = FakeSite(detail=[_wp_post(101, title="新 &amp; 旧 &#8211; 改題")])
    prior = _prior(posts=[_row(101)], authors=[_author()], post_categories=[(101, 10)])
    result = _run(site, prior, WEEKDAY)
    expected = _row(101, title="新 & 旧 – 改題")
    assert result.posts[101] == expected
    assert result.changed_posts == (expected,)
    assert result.posts[101].first_seen_on == FIRST_SEEN


def test_diff_post_with_new_modified_time_is_changed() -> None:
    site = FakeSite(detail=[_wp_post(101, modified_gmt="2026-11-03T00:00:00")])
    prior = _prior(posts=[_row(101)], authors=[_author()])
    result = _run(site, prior)
    assert [row.post_id for row in result.changed_posts] == [101]
    assert result.posts[101].modified_at == datetime(2026, 11, 3, 0, 0, tzinfo=UTC)


@pytest.mark.parametrize(
    ("date_gmt", "expected_on"),
    [
        ("2026-10-01T03:00:00", date(2026, 10, 1)),
        ("2026-10-31T14:59:59", date(2026, 10, 31)),
        ("2026-10-31T15:00:00", date(2026, 11, 1)),  # 月末: UTC 15 時は Asia/Tokyo の翌日 0 時
        ("2026-12-31T14:59:59", date(2026, 12, 31)),
        ("2026-12-31T15:00:00", date(2027, 1, 1)),  # 年末
        ("2028-02-28T15:00:00", date(2028, 2, 29)),  # うるう日
    ],
)
def test_new_post_gets_jst_published_on_and_base_date_as_first_seen(
    date_gmt: str, expected_on: date
) -> None:
    site = FakeSite(detail=[_wp_post(101, date_gmt=date_gmt)])
    # 基準日は公開日。基準日より後に公開された記事は、まだ取り込まないため
    base = expected_on
    result = _run(site, _prior(), base)
    row = result.posts[101]
    assert row.published_on == expected_on
    assert row.published_at == datetime.fromisoformat(f"{date_gmt}+00:00")
    assert row.published_at.utcoffset() == timedelta(0)
    assert row.modified_at.utcoffset() == timedelta(0)
    assert row.first_seen_on == base
    assert result.changed_posts == (row,)
    assert result.authors == {"author-a": _author(first_seen_on=base)}


def test_new_post_published_after_base_date_is_not_imported_yet() -> None:
    """バッチの実行日（基準日の翌日）に公開された記事は、数字がまだないので取り込まない。"""
    base = date(2026, 11, 4)
    # UTC の 11-04 15:00 は JST の 11-05 0:00
    site = FakeSite(
        detail=[
            _wp_post(101, date_gmt="2026-11-04T14:59:59"),
            _wp_post(102, date_gmt="2026-11-04T15:00:00", author=8),
        ]
    )
    result = _run(site, _prior(), base)
    assert set(result.posts) == {101}
    assert result.deleted_post_ids == frozenset()
    # 取り込まない記事だけの著者は入れない。関連も入れない
    assert set(result.authors) == {"author-a"}
    assert {post_id for post_id, _ in result.post_categories} == {101}


def test_known_post_after_base_date_is_kept_but_not_measurable() -> None:
    # 基準日を過去にした実行では、すでに取り込んだ後の記事を消さない。集計の対象からは外す
    base = date(2026, 9, 1)
    site = FakeSite(detail=[], live=[(101, 7)])
    result = _run(site, _prior(posts=[_row(101)], authors=[_author()]), base)
    assert set(result.posts) == {101}
    assert result.measurable_posts(base) == {}
    assert set(result.measurable_posts(date(2026, 10, 1))) == {101}


def test_late_seen_counts_new_posts_older_than_refetch_window() -> None:
    base = date(2026, 11, 10)
    site = FakeSite(
        detail=[
            # 直近 7 日（11-04〜11-10）より前に公開: 日別の値が欠ける
            _wp_post(101, date_gmt="2026-11-03T03:00:00"),
            _wp_post(102, date_gmt="2026-11-04T03:00:00"),
            _wp_post(103, date_gmt="2026-10-01T03:00:00"),
        ]
    )
    # すでに取り込んである記事は数えない
    prior = _prior(posts=[_row(103)], authors=[_author()])
    assert _run(site, prior, base).late_seen == 1
    # backfill は全期間を取り直すので数えない
    assert _run(site, _prior(), base, full=True).late_seen == 0


# --- 不完全な応答で、履歴ごと消さない（03 §4） ---


def test_id_list_that_disagrees_with_total_header_stops() -> None:
    # ページの取得中に記事が増減してずれたとき。総件数と合わないので、削除の判定に使わない
    site = FakeSite(detail=[], live=[(101, 7), (102, 7)], id_total=3)
    prior = _prior(posts=[_row(101), _row(102), _row(103)], authors=[_author()])
    with pytest.raises(BatchValidationError):
        _run(site, prior)


def test_id_list_that_matches_total_header_is_accepted() -> None:
    site = FakeSite(detail=[], live=[(101, 7), (102, 7)], id_total=2)
    prior = _prior(posts=[_row(101), _row(102), _row(103)], authors=[_author()])
    assert _run(site, prior).deleted_post_ids == frozenset({103})


@pytest.mark.parametrize(
    ("previous", "remaining", "stops"),
    [
        (20, 10, False),  # 10 本までは消してよい
        (20, 9, True),
        (400, 380, False),  # 前回の 5%（20 本）まで
        (400, 379, True),
    ],
)
def test_daily_stops_when_too_many_posts_disappear(
    previous: int, remaining: int, stops: bool
) -> None:
    ids = range(1, previous + 1)
    prior = _prior(posts=[_row(post_id) for post_id in ids], authors=[_author()])
    site = FakeSite(detail=[], live=[(post_id, 7) for post_id in range(1, remaining + 1)])
    site.page_size = 1000
    if stops:
        with pytest.raises(BatchValidationError):
            _run(site, prior)
    else:
        assert len(_run(site, prior).deleted_post_ids) == previous - remaining
    # backfill では止めない。意図した大量の非公開化を反映する経路
    full_site = FakeSite(
        detail=[_wp_post(post_id) for post_id in range(1, remaining + 1)], page_size=1000
    )
    assert len(_run(full_site, prior, full=True).deleted_post_ids) == previous - remaining


def test_empty_category_list_stops_when_links_existed() -> None:
    # 前回はあったカテゴリが 1 つも返らない。広告の判定が全件外れるので、反映しない
    site = FakeSite(categories=[], detail=[], live=[(101, 7)])
    prior = _prior(posts=[_row(101)], authors=[_author()], post_categories=[(101, 10)])
    with pytest.raises(BatchValidationError):
        _run(site, prior)


def test_diff_post_missing_from_id_list_is_not_taken_in() -> None:
    """差分の取得と ID 一覧の取得の間に消えた記事。"""
    site = FakeSite(detail=[_wp_post(101), _wp_post(102)], live=[(102, 7)])
    prior = _prior(posts=[_row(101)], authors=[_author()], post_categories=[(101, 10)])
    result = _run(site, prior)
    assert set(result.posts) == {102}
    assert result.deleted_post_ids == frozenset({101})
    assert [row.post_id for row in result.changed_posts] == [102]
    assert result.post_categories == frozenset({(102, 10)})


def test_duplicated_post_across_pages_is_taken_once() -> None:
    """重複取得: ページをめくる間に記事がずれて、同じ記事が 2 ページに出る。"""
    site = FakeSite(
        detail=[_wp_post(101), _wp_post(102), _wp_post(102), _wp_post(103)],
        live=[(101, 7), (102, 7), (102, 7), (103, 7)],
        page_size=2,
    )
    result = _run(site, _prior())
    assert sorted(result.posts) == [101, 102, 103]
    assert sorted(row.post_id for row in result.changed_posts) == [101, 102, 103]
    assert result.post_categories == frozenset({(101, 10), (102, 10), (103, 10)})


def test_id_list_on_later_pages_is_not_deleted() -> None:
    """ID 一覧が複数ページのとき、2 ページ目以降の記事を削除と見なさない。"""
    ids = [101, 102, 103, 104, 105]
    site = FakeSite(live=[(post_id, 7) for post_id in ids], page_size=2)
    prior = _prior(posts=[_row(post_id) for post_id in ids], authors=[_author()])
    result = _run(site, prior)
    assert sorted(result.posts) == ids
    assert result.deleted_post_ids == frozenset()
    assert [request.url.params["page"] for request in site.id_list_requests()] == ["1", "2", "3"]


def test_rerun_with_previous_result_changes_nothing() -> None:
    """再実行: 1 回目の結果を前回の状態にして同じ応答を受けると、変更も削除も出ない。"""
    site = FakeSite(
        categories=[_wp_category(10, "地域"), _wp_category(AD_CATEGORY_ID, "広告")],
        detail=[_wp_post(101), _wp_post(102, author=8, categories=[AD_CATEGORY_ID])],
    )
    first = _run(site, _prior(last_success=None), WEEKDAY)
    assert len(first.changed_posts) == 2
    prior = _prior(
        posts=list(first.posts.values()),
        authors=list(first.authors.values()),
        post_categories=first.post_categories,
        post_tags=first.post_tags,
    )
    second = _run(site, prior, WEEKDAY + timedelta(days=1))
    assert second.changed_posts == ()
    assert second.deleted_post_ids == frozenset()
    assert second.posts == first.posts
    assert second.authors == first.authors
    assert second.post_categories == first.post_categories
    assert second.post_tags == first.post_tags


# --- 週 1 回（日曜）の著者の反映 ---


def test_sunday_reflects_author_change_of_post_outside_diff() -> None:
    site = FakeSite(live=[(101, 8)])
    prior = _prior(posts=[_row(101)], authors=[_author()], post_categories=[(101, 10)])
    result = _run(site, prior, SUNDAY)
    expected = _row(101, author_slug="author-b")
    assert result.posts == {101: expected}
    assert result.changed_posts == (expected,)
    assert result.deleted_post_ids == frozenset()
    # 使われなくなった著者は消え、新しい著者は基準日が初出になる
    assert result.authors == {"author-b": _author("author-b", "書き手B", first_seen_on=SUNDAY)}


def test_weekday_does_not_look_at_authors_of_posts_outside_diff() -> None:
    site = FakeSite(live=[(101, 8)])
    prior = _prior(posts=[_row(101)], authors=[_author()], post_categories=[(101, 10)])
    result = _run(site, prior, WEEKDAY)
    assert result.posts == prior.posts
    assert result.changed_posts == ()
    assert result.authors == prior.authors
    assert not any(path.startswith("/users/") for path in site.paths())


def test_sunday_reflects_display_name_change_and_keeps_first_seen_on() -> None:
    site = FakeSite(live=[(101, 7)], users={7: _wp_user("author-a", "改名した書き手")})
    prior = _prior(posts=[_row(101)], authors=[_author()])
    result = _run(site, prior, SUNDAY)
    assert result.authors == {"author-a": _author("author-a", "改名した書き手")}
    assert result.changed_posts == ()


# --- 広告（02 §3.1） ---


@pytest.mark.parametrize(
    ("post_categories", "expected"),
    [
        pytest.param([AD_CATEGORY_ID], True, id="ad-category"),
        pytest.param([30], True, id="child-of-ad-category"),
        pytest.param([10, 30], True, id="ad-and-other"),
        pytest.param([10], False, id="other-category"),
        pytest.param([31], False, id="child-of-other-category"),
        pytest.param([], False, id="no-category"),
    ],
)
def test_new_post_is_ad_by_category(post_categories: list[int], expected: bool) -> None:
    site = FakeSite(
        categories=[
            _wp_category(10, "地域"),
            _wp_category(31, "駅前", parent=10),
            _wp_category(AD_CATEGORY_ID, "広告"),
            _wp_category(30, "お知らせ", parent=AD_CATEGORY_ID),
        ],
        detail=[_wp_post(101, categories=post_categories)],
    )
    result = _run(site, _prior())
    assert result.posts[101].is_ad is expected
    # 変更の一覧には、最終的な is_ad の行が 1 つだけ入る
    assert result.changed_posts == (result.posts[101],)


def test_post_removed_from_ad_category_is_no_longer_ad() -> None:
    site = FakeSite(
        categories=[_wp_category(10, "地域"), _wp_category(AD_CATEGORY_ID, "広告")],
        detail=[_wp_post(101, categories=[10])],
    )
    prior = _prior(
        posts=[_row(101, is_ad=True)], authors=[_author()], post_categories=[(101, AD_CATEGORY_ID)]
    )
    result = _run(site, prior)
    assert result.posts[101] == _row(101, is_ad=False)
    assert result.changed_posts == (_row(101, is_ad=False),)
    assert result.post_categories == frozenset({(101, 10)})


def test_ad_post_refetched_without_change_is_not_changed() -> None:
    site = FakeSite(
        categories=[_wp_category(AD_CATEGORY_ID, "広告")],
        detail=[_wp_post(101, categories=[AD_CATEGORY_ID])],
    )
    prior = _prior(
        posts=[_row(101, is_ad=True)], authors=[_author()], post_categories=[(101, AD_CATEGORY_ID)]
    )
    result = _run(site, prior)
    assert result.posts == prior.posts
    assert result.changed_posts == ()


@pytest.mark.parametrize(
    ("was_ad", "parent", "expected"),
    [
        pytest.param(False, AD_CATEGORY_ID, True, id="moved-under-ad"),
        pytest.param(True, 0, False, id="moved-out-of-ad"),
        pytest.param(True, AD_CATEGORY_ID, True, id="stays-under-ad"),
    ],
)
def test_category_parent_change_updates_ad_flag_of_post_outside_diff(
    was_ad: bool, parent: int, expected: bool
) -> None:
    site = FakeSite(
        categories=[_wp_category(AD_CATEGORY_ID, "広告"), _wp_category(30, "お知らせ", parent)],
        live=[(101, 7)],
    )
    prior = _prior(
        posts=[_row(101, is_ad=was_ad)], authors=[_author()], post_categories=[(101, 30)]
    )
    result = _run(site, prior)
    assert result.posts[101] == _row(101, is_ad=expected)
    assert result.changed_posts == (() if was_ad == expected else (_row(101, is_ad=expected),))


def test_ad_category_ids_are_ad_category_and_its_children() -> None:
    categories = [
        CategoryRow(10, "地域", None, "地域"),
        CategoryRow(AD_CATEGORY_ID, "広告", None, "広告"),
        CategoryRow(30, "お知らせ", AD_CATEGORY_ID, "広告 > お知らせ"),
        CategoryRow(31, "駅前", 10, "地域 > 駅前"),
    ]
    assert ad_category_ids(categories) == frozenset({AD_CATEGORY_ID, 30})
    assert ad_category_ids([]) == frozenset()


# --- カテゴリ ---


def test_categories_put_parents_first_and_build_path() -> None:
    site = FakeSite(
        categories=[
            _wp_category(12, "催し", parent=11),
            _wp_category(11, "駅前", parent=10),
            _wp_category(20, "催し", parent=15),
            _wp_category(15, "川沿い"),
            _wp_category(10, "地域"),
        ]
    )
    result = _run(site, _prior())
    assert result.categories == (
        CategoryRow(10, "地域", None, "地域"),
        CategoryRow(15, "川沿い", None, "川沿い"),
        CategoryRow(11, "駅前", 10, "地域 > 駅前"),
        # 同じ名前の子は path で区別できる
        CategoryRow(20, "催し", 15, "川沿い > 催し"),
        CategoryRow(12, "催し", 11, "地域 > 駅前 > 催し"),
    )


def test_category_whose_parent_is_gone_becomes_top_level() -> None:
    site = FakeSite(categories=[_wp_category(11, "駅前", parent=99)])
    result = _run(site, _prior())
    assert result.categories == (CategoryRow(11, "駅前", None, "駅前"),)


def test_categories_across_pages_are_all_taken() -> None:
    site = FakeSite(
        categories=[_wp_category(category_id, f"分類{category_id}") for category_id in range(1, 6)],
        page_size=2,
    )
    result = _run(site, _prior())
    assert [row.category_id for row in result.categories] == [1, 2, 3, 4, 5]
    assert site.paths()[:3] == ["/categories", "/categories", "/categories"]


def test_links_to_removed_category_are_dropped() -> None:
    site = FakeSite(detail=[_wp_post(102, categories=[10, 99])], live=[(101, 7), (102, 7)])
    prior = _prior(posts=[_row(101)], authors=[_author()], post_categories=[(101, 10), (101, 12)])
    result = _run(site, prior)
    assert result.post_categories == frozenset({(101, 10), (102, 10)})


# --- 著者（NFR-35） ---


def test_only_authors_in_use_remain() -> None:
    site = FakeSite(live=[(101, 7)])
    prior = _prior(
        posts=[_row(101), _row(102, author_slug="author-b")],
        authors=[_author(), _author("author-b", "書き手B")],
    )
    result = _run(site, prior)
    assert result.authors == {"author-a": _author()}


def test_author_display_name_is_unescaped() -> None:
    site = FakeSite(
        detail=[_wp_post(101)], users={7: _wp_user("author-a", "山 &amp; 川 &#038; 橋")}
    )
    result = _run(site, _prior(), WEEKDAY)
    assert result.authors["author-a"].display_name == "山 & 川 & 橋"
    assert result.authors["author-a"].author_url == f"{SITE}/author/author-a/"


def test_numeric_author_id_does_not_leave_fetch() -> None:
    """著者の数値 ID は結果のどこにも残らない（NFR-35）。"""
    site = FakeSite(
        detail=[_wp_post(101, author=70007)],
        live=[(101, 70007)],
        users={70007: _wp_user("author-a", "書き手A")},
    )
    result = _run(site, _prior(), SUNDAY)
    assert result.posts[101].author_slug == "author-a"
    assert "70007" not in repr(result)


def test_unknown_author_fails_fetch() -> None:
    site = FakeSite(detail=[_wp_post(101, author=404)])
    with pytest.raises(httpx.HTTPStatusError):
        _run(site, _prior())


# --- タグ ---


def test_tags_are_returned_in_response_order() -> None:
    site = FakeSite(tags=[_wp_tag(21, "散歩"), _wp_tag(20, "催し")])
    result = _run(site, _prior())
    assert result.tags == ((21, "散歩"), (20, "催し"))


def test_links_to_removed_tag_are_dropped() -> None:
    site = FakeSite(detail=[_wp_post(102, tags=[20, 99])], live=[(101, 7), (102, 7)])
    prior = _prior(posts=[_row(101)], authors=[_author()], post_tags=[(101, 20), (101, 21)])
    result = _run(site, prior)
    assert result.post_tags == frozenset({(101, 20), (102, 20)})


def test_diff_post_replaces_its_links() -> None:
    site = FakeSite(
        categories=[_wp_category(10, "地域"), _wp_category(11, "駅前")],
        tags=[_wp_tag(20, "催し"), _wp_tag(21, "散歩")],
        detail=[_wp_post(101, categories=[11], tags=[21])],
    )
    prior = _prior(
        posts=[_row(101)], authors=[_author()], post_categories=[(101, 10)], post_tags=[(101, 20)]
    )
    result = _run(site, prior)
    assert result.post_categories == frozenset({(101, 11)})
    assert result.post_tags == frozenset({(101, 21)})


# --- 応答の検証 ---


def test_response_missing_required_field_is_validation_error() -> None:
    post = _wp_post(101)
    del post["content"]
    with pytest.raises(pydantic.ValidationError) as excinfo:
        _run(FakeSite(detail=[post]), _prior())
    # 検証エラーに応答の中身を含めない（03 §15）
    assert "記事" not in str(excinfo.value)


# --- 公開中なのに、前回の状態にも差分にもない記事（03 §4 の 4b） ---


def _include_requests(site: FakeSite) -> list[httpx.Request]:
    return [request for request in site.detail_requests() if "include" in request.url.params]


def test_live_post_missing_from_prior_and_diff_is_fetched_by_id() -> None:
    """予約投稿は公開の時点で modified が変わらず差分に出ないので、ID を指定して取り込む。"""
    site = FakeSite(detail=[], live=[(101, 7), (103, 7)], by_id=[_wp_post(103)])
    prior = _prior(posts=[_row(101)], authors=[_author()])
    result = _run(site, prior)
    assert set(result.posts) == {101, 103}
    assert [row.post_id for row in result.changed_posts] == [103]
    requests = _include_requests(site)
    assert [request.url.params["include"] for request in requests] == ["103"]
    # 範囲を広げない。公開中の記事を、同じ項目だけで取る
    assert requests[0].url.params["status"] == "publish"
    plain = next(r for r in site.detail_requests() if "include" not in r.url.params)
    assert requests[0].url.params["_fields"] == plain.url.params["_fields"]


def test_missing_protected_post_is_fetched_by_id_but_not_imported() -> None:
    site = FakeSite(detail=[], live=[(101, 7), (103, 7)], by_id=[_wp_post(103, protected=True)])
    result = _run(site, _prior(posts=[_row(101)], authors=[_author()]))
    assert set(result.posts) == {101}
    assert len(_include_requests(site)) == 1


def test_live_post_that_vanishes_before_fetch_by_id_is_skipped() -> None:
    # ID 一覧の取得のあとで消えた記事は、取れなくても止まらない
    site = FakeSite(detail=[], live=[(101, 7), (103, 7)])
    result = _run(site, _prior(posts=[_row(101)], authors=[_author()]))
    assert set(result.posts) == {101}


def test_no_fetch_by_id_when_every_live_post_is_known() -> None:
    site = FakeSite(detail=[_wp_post(102)], live=[(101, 7), (102, 7)])
    _run(site, _prior(posts=[_row(101)], authors=[_author()]))
    assert _include_requests(site) == []


def test_fetch_by_id_is_chunked_by_page_size(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("takatsu_batch.wp_fetch.WP_PER_PAGE", 2)
    ids = [201, 202, 203]
    site = FakeSite(
        detail=[],
        live=[(post_id, 7) for post_id in ids],
        by_id=[_wp_post(post_id) for post_id in ids],
        page_size=2,
    )
    result = _run(site, _prior())
    assert set(result.posts) == set(ids)
    assert [request.url.params["include"] for request in _include_requests(site)] == [
        "201,202",
        "203",
    ]


@pytest.mark.parametrize("field_name", ["date_gmt", "modified_gmt"])
def test_malformed_post_date_is_a_validation_failure(field_name: str) -> None:
    post = _wp_post(101)
    post[field_name] = "not-a-date"
    with pytest.raises(BatchValidationError):
        _run(FakeSite(detail=[post]), _prior())


def test_category_and_tag_names_are_unescaped() -> None:
    site = FakeSite(
        categories=[_wp_category(1, "食 &amp; 暮らし"), _wp_category(10, "店 &amp; 人", parent=1)],
        tags=[_wp_tag(20, "朝 &amp; 夜")],
    )
    result = _run(site, _prior())
    assert [(row.name, row.path) for row in result.categories] == [
        ("食 & 暮らし", "食 & 暮らし"),
        ("店 & 人", "食 & 暮らし > 店 & 人"),
    ]
    assert result.tags == ((20, "朝 & 夜"),)
