"""WP REST API からの取得（03 §4、D-03、NFR-34、NFR-35、NFR-72）。読み取りだけ。

結果はメモリに持ち、書き込みは write 工程でまとめて行う（03 §1）。
著者の数値 ID は slug に解決したら捨てる。メモリの外に出さない（NFR-35）。
"""

import html
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from itertools import batched
from typing import Final

import httpx
from pydantic import TypeAdapter

from takatsu_batch import tz
from takatsu_batch.config import (
    AD_CATEGORY_ID,
    REFETCH_DAYS,
    SITE_ORIGIN,
    WP_DELETE_GUARD_MIN_POSTS,
    WP_DELETE_GUARD_PERCENT,
    WP_MAX_RETRIES,
    WP_PER_PAGE,
    WP_REQUEST_INTERVAL_MS,
    WP_USER_AGENT,
)
from takatsu_batch.db import AuthorRow, PostRow, PriorState
from takatsu_batch.errors import BatchValidationError
from takatsu_batch.models import BatchModel

_API_ROOT: Final = f"{SITE_ORIGIN}/wp-json/wp/v2"
_SITE_PREFIX: Final = f"{SITE_ORIGIN}/"
_RETRY_BASE_SECONDS: Final = 1.0
_RETRY_STATUS: Final = frozenset({429, 500, 502, 503, 504})
# 1 つの一覧で読むページの上限（100 件 × 50 ページ）。応答のヘッダの値で読み続けないため
_MAX_PAGES: Final = 50
_SUNDAY: Final = 6
_CATEGORY_FIELDS: Final = "id,name,parent"
_TAG_FIELDS: Final = "id,name"
_POST_FIELDS: Final = (
    "id,date_gmt,modified_gmt,link,title.rendered,author,categories,tags,content.protected"
)
_ID_FIELDS: Final = "id"
_ID_AUTHOR_FIELDS: Final = "id,author"
_USER_FIELDS: Final = "name,slug,link"


class _WpCategory(BatchModel):
    id: int
    name: str
    parent: int = 0


class _WpTag(BatchModel):
    id: int
    name: str


class _WpRendered(BatchModel):
    rendered: str


class _WpContent(BatchModel):
    protected: bool


class _WpPost(BatchModel):
    id: int
    date_gmt: str
    modified_gmt: str
    link: str
    title: _WpRendered
    author: int
    categories: list[int]
    tags: list[int]
    content: _WpContent


class _WpPostId(BatchModel):
    id: int
    author: int | None = None


class _WpUser(BatchModel):
    name: str
    slug: str
    link: str


_CATEGORIES: Final = TypeAdapter(list[_WpCategory])
_TAGS: Final = TypeAdapter(list[_WpTag])
_POSTS: Final = TypeAdapter(list[_WpPost])
_POST_IDS: Final = TypeAdapter(list[_WpPostId])


@dataclass(frozen=True, slots=True)
class CategoryRow:
    category_id: int
    name: str
    parent_id: int | None
    path: str


@dataclass(frozen=True, slots=True)
class WpResult:
    """wp_fetch の結果。posts と authors は今回の公開範囲の全体（前回の分との合成）。"""

    posts: dict[int, PostRow]
    changed_posts: tuple[PostRow, ...]
    deleted_post_ids: frozenset[int]
    authors: dict[str, AuthorRow]
    categories: tuple[CategoryRow, ...]
    tags: tuple[tuple[int, str], ...]
    post_categories: frozenset[tuple[int, int]]
    post_tags: frozenset[tuple[int, int]]
    requests: int
    # 今回初めて取り込んだ記事のうち、公開日が直近 7 日より前のもの。日別の値は直近 7 日ぶんしか
    # 取らないので、それより前の値が欠ける。backfill で埋める（03 §9）
    late_seen: int = 0

    def measurable_posts(self, base_date: date) -> dict[int, PostRow]:
        """基準日までに公開された記事。GA4 の取得と集計はこの範囲で行う。"""
        return {
            post_id: row for post_id, row in self.posts.items() if row.published_on <= base_date
        }


class WpClient:
    """間隔、再試行、User-Agent を 1 か所で守る。"""

    def __init__(
        self,
        http: httpx.Client,
        sleep: Callable[[float], None],
        clock: Callable[[], float],
    ) -> None:
        self._http = http
        self._sleep = sleep
        self._clock = clock
        self._last_request_at: float | None = None
        self.requests = 0
        # 直前の get_pages の X-WP-Total（総件数）。ヘッダがなければ None
        self.last_total: int | None = None

    def _wait_interval(self) -> None:
        if self._last_request_at is None:
            return
        remaining = WP_REQUEST_INTERVAL_MS / 1000 - (self._clock() - self._last_request_at)
        if remaining > 0:
            self._sleep(remaining)

    def _send_once(self, path: str, params: Mapping[str, str | int]) -> httpx.Response:
        self._wait_interval()
        self.requests += 1
        try:
            return self._http.get(
                f"{_API_ROOT}{path}",
                params=dict(params),
                headers={"User-Agent": WP_USER_AGENT},
                follow_redirects=False,
                timeout=30.0,
            )
        finally:
            self._last_request_at = self._clock()

    def get(self, path: str, params: Mapping[str, str | int]) -> httpx.Response:
        """失敗は 3 回まで指数バックオフで再試行する。それでも失敗したら httpx の例外のまま。"""
        for attempt in range(WP_MAX_RETRIES + 1):
            retry = attempt < WP_MAX_RETRIES
            try:
                response = self._send_once(path, params)
            except httpx.TransportError:
                if not retry:
                    raise
            else:
                if response.status_code not in _RETRY_STATUS or not retry:
                    response.raise_for_status()
                    return response
            self._sleep(_RETRY_BASE_SECONDS * 2**attempt)
        raise httpx.TransportError("unreachable")  # for の中で必ず return か raise する

    def get_pages(self, path: str, params: Mapping[str, str | int]) -> list[bytes]:
        """X-WP-TotalPages に従って全ページを取る。応答の本文は呼び出し側が検証する。"""
        bodies: list[bytes] = []
        page = 1
        while True:
            response = self.get(path, {**params, "per_page": WP_PER_PAGE, "page": page})
            bodies.append(response.content)
            if page == 1:
                self.last_total = _total_items(response)
            total = _total_pages(response)
            if page >= total:
                return bodies
            page += 1


def _total_pages(response: httpx.Response) -> int:
    value = response.headers.get("X-WP-TotalPages", "")
    if not value.isascii() or not value.isdigit() or int(value) > _MAX_PAGES:
        raise BatchValidationError
    return int(value)


def _total_items(response: httpx.Response) -> int | None:
    value = response.headers.get("X-WP-Total", "")
    return int(value) if value.isascii() and value.isdigit() else None


def _check_site_url(url: str) -> None:
    """リンク先は対象サイトの配下に限る（FR-04、NFR-91）。"""
    if not url.startswith(_SITE_PREFIX):
        raise BatchValidationError


def _build_categories(raw: Iterable[_WpCategory]) -> tuple[CategoryRow, ...]:
    """親を先に並べる（wp_category の自己参照の FK のため）。path は「親 > 子」。"""
    by_id = {category.id: category for category in raw}

    def chain(category: _WpCategory) -> list[_WpCategory]:
        names = [category]
        seen = {category.id}
        while names[0].parent in by_id and names[0].parent not in seen:
            seen.add(names[0].parent)
            names.insert(0, by_id[names[0].parent])
        return names

    rows = [
        (
            len(chain(category)),
            CategoryRow(
                category.id,
                html.unescape(category.name),
                category.parent if category.parent in by_id else None,
                " > ".join(html.unescape(item.name) for item in chain(category)),
            ),
        )
        for category in by_id.values()
    ]
    return tuple(row for _, row in sorted(rows, key=lambda item: (item[0], item[1].category_id)))


def ad_category_ids(categories: Iterable[CategoryRow]) -> frozenset[int]:
    """広告カテゴリと配下の子（02 §3.1）。"""
    return frozenset(
        category.category_id
        for category in categories
        if AD_CATEGORY_ID in (category.category_id, category.parent_id)
    )


def _modified_after(prior: PriorState, full: bool) -> datetime | None:
    if full or prior.last_success_started_at is None:
        return None
    return prior.last_success_started_at - timedelta(days=1)


def _fetch_posts(client: WpClient, since: datetime | None) -> list[_WpPost]:
    params: dict[str, str | int] = {"status": "publish", "_fields": _POST_FIELDS}
    if since is not None:
        params["modified_after"] = tz.format_utc(since)
    posts: list[_WpPost] = []
    for body in client.get_pages("/posts", params):
        posts.extend(_POSTS.validate_json(body))
    return posts


def _fetch_posts_by_id(client: WpClient, post_ids: Sequence[int]) -> list[_WpPost]:
    """公開中の ID 一覧にあるのに、前回の状態にも差分にもない記事を、ID を指定して取る。

    予約投稿は公開の時点で modified が変わらないので、差分の条件（modified_after）に掛からない。
    パスワード付きの記事は取り込まないので、ある間は毎回ここで取って捨てる。
    """
    posts: list[_WpPost] = []
    for chunk in batched(post_ids, WP_PER_PAGE, strict=False):
        params: dict[str, str | int] = {
            "status": "publish",
            "_fields": _POST_FIELDS,
            "include": ",".join(str(post_id) for post_id in chunk),
        }
        for body in client.get_pages("/posts", params):
            posts.extend(_POSTS.validate_json(body))
    return posts


def _parse_gmt(value: str) -> datetime:
    """日時として読めない値は検証の失敗にする（種別 validation）。"""
    try:
        return tz.parse_wp_gmt(value)
    except ValueError:
        raise BatchValidationError from None


def _fetch_id_list(client: WpClient, with_author: bool) -> list[_WpPostId]:
    fields = _ID_AUTHOR_FIELDS if with_author else _ID_FIELDS
    ids: list[_WpPostId] = []
    for body in client.get_pages("/posts", {"status": "publish", "_fields": fields}):
        ids.extend(_POST_IDS.validate_json(body))
    # 一覧は削除の判定に使う。ページの取得中に記事が増減してずれたときや、不完全な応答のときは、
    # 総件数と合わないので止める（次の実行でやり直す）
    if client.last_total is not None and client.last_total != len({item.id for item in ids}):
        raise BatchValidationError
    return ids


def _fetch_author(client: WpClient, author_id: int) -> _WpUser:
    response = client.get(f"/users/{author_id}", {"_fields": _USER_FIELDS})
    user = _WpUser.model_validate_json(response.content)
    _check_site_url(user.link)
    return user


def fetch(client: WpClient, prior: PriorState, base_date: date, *, full: bool) -> WpResult:
    """カテゴリ、タグ、差分の記事、ID 一覧、必要な著者の順に取る（03 §4）。"""
    categories = _build_categories(
        item
        for body in client.get_pages("/categories", {"_fields": _CATEGORY_FIELDS})
        for item in _CATEGORIES.validate_json(body)
    )
    if not categories and prior.post_categories:
        # 前回はあったカテゴリが 1 つも返らない。不完全な応答として止める（広告の判定が全件外れる）
        raise BatchValidationError
    tags = tuple(
        (item.id, html.unescape(item.name))
        for body in client.get_pages("/tags", {"_fields": _TAG_FIELDS})
        for item in _TAGS.validate_json(body)
    )
    fetched = _fetch_posts(client, _modified_after(prior, full))
    # 週 1 回（日曜）は著者の変更も反映する。ID 一覧を author つきで取り、1 回で兼ねる
    weekly = base_date.weekday() == _SUNDAY
    id_list = _fetch_id_list(client, with_author=weekly)
    known_ids = set(prior.posts) | {post.id for post in fetched}
    missing_ids = sorted({item.id for item in id_list} - known_ids)
    if missing_ids:
        fetched.extend(_fetch_posts_by_id(client, missing_ids))

    protected = {post.id for post in fetched if post.content.protected}
    visible = [post for post in fetched if not post.content.protected]
    author_ids = {post.author for post in visible}
    if weekly:
        author_ids |= {item.author for item in id_list if item.author is not None}
    # 著者の数値 ID はこの関数の中だけで使う（NFR-35）
    users = {author_id: _fetch_author(client, author_id) for author_id in sorted(author_ids)}

    authors = _merge_authors(prior, users.values(), base_date)
    live_ids = {item.id for item in id_list} - protected
    posts, changed = _merge_posts(
        prior, visible, live_ids, users, id_list if weekly else [], base_date
    )
    post_categories, post_tags = _merge_links(prior, visible, posts, categories, tags)
    posts, changed = _apply_ad_flags(posts, changed, post_categories, categories)
    deleted = frozenset(prior.posts) - frozenset(posts)
    _check_deleted_count(len(deleted), len(prior.posts), full=full)
    used_slugs = {post.author_slug for post in posts.values()}
    first_refetched_day = base_date - timedelta(days=REFETCH_DAYS - 1)
    return WpResult(
        posts=posts,
        changed_posts=changed,
        deleted_post_ids=deleted,
        authors={slug: row for slug, row in authors.items() if slug in used_slugs},
        categories=categories,
        tags=tags,
        post_categories=post_categories,
        post_tags=post_tags,
        requests=client.requests,
        late_seen=0
        if full
        else sum(
            post_id not in prior.posts and row.published_on < first_refetched_day
            for post_id, row in posts.items()
        ),
    )


def _check_deleted_count(deleted: int, previous: int, *, full: bool) -> None:
    """daily で一度に消える記事が多すぎるときは止める（不完全な一覧で履歴ごと消さないため）。

    消した記事の日別の値は cascade で消え、戻すには backfill が要る。意図した大量の非公開化は
    backfill で反映する（03 §4）。
    """
    limit = max(WP_DELETE_GUARD_MIN_POSTS, previous * WP_DELETE_GUARD_PERCENT // 100)
    if not full and deleted > limit:
        raise BatchValidationError


def _merge_authors(
    prior: PriorState, users: Iterable[_WpUser], base_date: date
) -> dict[str, AuthorRow]:
    authors = dict(prior.authors)
    for user in users:
        known = authors.get(user.slug)
        authors[user.slug] = AuthorRow(
            user.slug,
            html.unescape(user.name),
            user.link,
            known.first_seen_on if known else base_date,
        )
    return authors


def _merge_posts(
    prior: PriorState,
    visible: Iterable[_WpPost],
    live_ids: set[int],
    users: Mapping[int, _WpUser],
    weekly_ids: Iterable[_WpPostId],
    base_date: date,
) -> tuple[dict[int, PostRow], tuple[PostRow, ...]]:
    """前回の行に今回の差分を重ね、ID 一覧にない記事を落とす（NFR-34、FR-72）。"""
    merged = {post_id: row for post_id, row in prior.posts.items() if post_id in live_ids}
    changed: dict[int, PostRow] = {}
    for post in visible:
        # 差分の取得と ID 一覧の取得の間に消えた記事は入れない
        if post.id not in live_ids:
            continue
        _check_site_url(post.link)
        published_at = _parse_gmt(post.date_gmt)
        known = prior.posts.get(post.id)
        if known is None and tz.jst_date(published_at) > base_date:
            # 基準日より後に公開された記事は、まだ取り込まない（数字がまだないため）。
            # 次の実行で、差分か ID を指定した取得で入る
            continue
        row = PostRow(
            post_id=post.id,
            title=html.unescape(post.title.rendered),
            post_url=post.link,
            author_slug=users[post.author].slug,
            published_at=published_at,
            published_on=tz.jst_date(published_at),
            modified_at=_parse_gmt(post.modified_gmt),
            is_ad=known.is_ad if known else False,
            first_seen_on=known.first_seen_on if known else base_date,
        )
        merged[post.id] = row
        if known != row:
            changed[post.id] = row
    for item in weekly_ids:
        current = merged.get(item.id)
        if current is None or item.author is None:
            continue
        slug = users[item.author].slug
        if current.author_slug != slug:
            row = _replace_author(current, slug)
            merged[item.id] = row
            changed[item.id] = row
    return merged, tuple(changed.values())


def _replace_author(row: PostRow, slug: str) -> PostRow:
    return PostRow(
        row.post_id,
        row.title,
        row.post_url,
        slug,
        row.published_at,
        row.published_on,
        row.modified_at,
        row.is_ad,
        row.first_seen_on,
    )


def _merge_links(
    prior: PriorState,
    visible: Iterable[_WpPost],
    posts: Mapping[int, PostRow],
    categories: Iterable[CategoryRow],
    tags: Iterable[tuple[int, str]],
) -> tuple[frozenset[tuple[int, int]], frozenset[tuple[int, int]]]:
    """記事 × カテゴリ / タグの最終形。消えたカテゴリ・タグと消えた記事の行を落とす。"""
    fetched = {post.id: post for post in visible}
    known_categories = {category.category_id for category in categories}
    known_tags = {tag_id for tag_id, _ in tags}

    def merge(
        previous: Iterable[tuple[int, int]],
        current: Callable[[_WpPost], Iterable[int]],
        known: set[int],
    ) -> frozenset[tuple[int, int]]:
        kept = {
            (post_id, term)
            for post_id, term in previous
            if post_id in posts and post_id not in fetched and term in known
        }
        kept |= {
            (post_id, term)
            for post_id, post in fetched.items()
            if post_id in posts
            for term in current(post)
            if term in known
        }
        return frozenset(kept)

    return (
        merge(prior.post_categories, lambda post: post.categories, known_categories),
        merge(prior.post_tags, lambda post: post.tags, known_tags),
    )


def _apply_ad_flags(
    posts: dict[int, PostRow],
    changed: tuple[PostRow, ...],
    post_categories: Iterable[tuple[int, int]],
    categories: Iterable[CategoryRow],
) -> tuple[dict[int, PostRow], tuple[PostRow, ...]]:
    """is_ad を全記事について決め直す（カテゴリの親が変わっても追従する）。"""
    ad_ids = ad_category_ids(categories)
    ad_posts = {post_id for post_id, category_id in post_categories if category_id in ad_ids}
    changed_by_id = {row.post_id: row for row in changed}
    result: dict[int, PostRow] = {}
    for post_id, row in posts.items():
        is_ad = post_id in ad_posts
        if row.is_ad == is_ad:
            result[post_id] = row
            continue
        updated = PostRow(
            row.post_id,
            row.title,
            row.post_url,
            row.author_slug,
            row.published_at,
            row.published_on,
            row.modified_at,
            is_ad,
            row.first_seen_on,
        )
        result[post_id] = updated
        changed_by_id[post_id] = updated
    return result, tuple(changed_by_id.values())
