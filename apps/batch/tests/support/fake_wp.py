"""WP REST API の偽物（07 §5）。respx のルートに side_effect として渡す。値はすべて架空。

対象サイトには接続しない。受け取ったリクエストと受信時刻を記録し、I-B-06 の検査に使う。
"""

import math
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import httpx
import respx

from takatsu_batch.config import SITE_ORIGIN

API_PREFIX = "/wp-json/wp/v2"
_ID_LIST_FIELDS = frozenset({"id", "id,author"})

type WpItem = dict[str, Any]


def wp_post(
    post_id: int,
    *,
    date_gmt: str,
    author: int,
    categories: list[int],
    tags: list[int] | None = None,
    title: str | None = None,
    modified_gmt: str | None = None,
    protected: bool = False,
) -> WpItem:
    """記事 1 本。date_gmt と modified_gmt はタイムゾーンなしの UTC（WP REST API の形）。"""
    return {
        "id": post_id,
        "date_gmt": date_gmt,
        "modified_gmt": modified_gmt or date_gmt,
        "link": f"{SITE_ORIGIN}/{post_id}/",
        "title": {"rendered": title or f"架空の記事 {post_id}"},
        "author": author,
        "categories": categories,
        "tags": tags or [],
        "content": {"protected": protected},
    }


def wp_user(slug: str, name: str) -> dict[str, str]:
    return {"name": name, "slug": slug, "link": f"{SITE_ORIGIN}/author/{slug}/"}


@dataclass
class FakeWp:
    categories: list[WpItem]
    tags: list[WpItem]
    users: dict[int, dict[str, str]]
    posts: list[WpItem]
    clock: Callable[[], float] = time.monotonic
    requests: list[httpx.Request] = field(default_factory=list)
    request_times: list[float] = field(default_factory=list)

    def install(self, router: respx.MockRouter) -> None:
        router.get(url__startswith=f"{SITE_ORIGIN}/wp-json/").mock(side_effect=self.handle)

    def post_requests(self, *, id_list: bool) -> list[httpx.Request]:
        """記事の取得のうち、ID 一覧（_fields=id）か、本体（差分）かで分ける。"""
        return [
            request
            for request in self.requests
            if request.url.path == f"{API_PREFIX}/posts"
            and (request.url.params.get("_fields") in _ID_LIST_FIELDS) == id_list
        ]

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        self.request_times.append(self.clock())
        path = request.url.path.removeprefix(API_PREFIX)
        params = request.url.params
        if path == "/categories":
            return self._paged(self.categories, params)
        if path == "/tags":
            return self._paged(self.tags, params)
        if path == "/posts":
            return self._posts(params)
        if path.startswith("/users/"):
            user = self.users.get(int(path.removeprefix("/users/")))
            return httpx.Response(404) if user is None else httpx.Response(200, json=user)
        return httpx.Response(404)

    def _posts(self, params: httpx.QueryParams) -> httpx.Response:
        if params.get("status") != "publish":
            return httpx.Response(400)
        fields = params.get("_fields", "")
        if fields in _ID_LIST_FIELDS:
            names = fields.split(",")
            return self._paged(
                [{name: post[name] for name in names} for post in self.posts], params
            )
        items = self.posts
        include = params.get("include")
        if include is not None:
            wanted = {int(value) for value in include.split(",")}
            items = [post for post in items if post["id"] in wanted]
        after = params.get("modified_after")
        if after is not None:
            # どちらも同じ桁の ISO 8601 なので、文字列のまま比べられる
            items = [post for post in items if post["modified_gmt"] > after.removesuffix("Z")]
        return self._paged(items, params)

    @staticmethod
    def _paged(items: list[WpItem], params: httpx.QueryParams) -> httpx.Response:
        per_page = int(params.get("per_page", "10"))
        page = int(params.get("page", "1"))
        total_pages = max(1, math.ceil(len(items) / per_page))
        return httpx.Response(
            200,
            json=items[(page - 1) * per_page : page * per_page],
            headers={"X-WP-Total": str(len(items)), "X-WP-TotalPages": str(total_pages)},
        )
