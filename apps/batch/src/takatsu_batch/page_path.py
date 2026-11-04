"""GA4 の pagePath の正規化と記事 ID の取り出し（03 §5.1、D-05）。"""

import re
from collections.abc import Collection
from typing import Final, Literal

type PageKind = Literal["article", "unknown_article", "non_article"]

# \d は Unicode の数字にも一致するので [0-9] で書く。先頭ゼロ（/04812/）は記事 ID として扱わない。
# 桁数は integer の最大（10 桁）までに限り、巨大な数字列を int に変換しない。
_ARTICLE_PATH: Final = re.compile(r"/([1-9][0-9]{0,9})/")
_SLASHES: Final = re.compile(r"/{2,}")
# wp_post.post_id は Postgres の integer。これを超える数字列は投稿 ID になりえない。
_MAX_POST_ID: Final = 2_147_483_647


def normalize_page_path(raw: str) -> str:
    """規則 1〜3: 小文字化と空白の除去、クエリとフラグメントの除去、スラッシュの整形。"""
    path = raw.lower()
    for separator in ("?", "#"):
        path = path.split(separator, 1)[0]
    # クエリの前に空白があっても残らないよう、除去の後で strip する
    path = _SLASHES.sub("/", path.strip())
    return path if path.endswith("/") else f"{path}/"


def extract_post_id(raw: str) -> int | None:
    """規則 4・6: `/<数字>/` だけを記事 ID とする。`/4812/2/` などは記事以外（None）。"""
    match = _ARTICLE_PATH.fullmatch(normalize_page_path(raw))
    if match is None:
        return None
    post_id = int(match.group(1))
    return post_id if post_id <= _MAX_POST_ID else None


def classify_page_path(raw: str, known_post_ids: Collection[int]) -> PageKind:
    """規則 4・5: 記事、削除済み・未知の記事、記事以外に分ける。後ろ 2 つは記事単位で格納しない。"""
    post_id = extract_post_id(raw)
    if post_id is None:
        return "non_article"
    return "article" if post_id in known_post_ids else "unknown_article"
