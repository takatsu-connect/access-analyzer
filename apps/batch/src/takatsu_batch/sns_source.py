"""sessionSource から SNS 区分への正規化（03 §5.2、D-02、M-11）。"""

from typing import Final, Literal

from takatsu_batch.config import SnsBucket

type SnsResult = SnsBucket | Literal["unmapped"]

# 判定の順序は 03 §5.2 の表のとおり
_RULES: Final[tuple[tuple[SnsBucket, frozenset[str], tuple[str, ...]], ...]] = (
    (
        "instagram",
        frozenset({"l.instagram.com", "instagram.com", "ig", "instagram"}),
        (".instagram.com",),
    ),
    (
        "facebook",
        frozenset(
            {
                "facebook.com",
                "lm.facebook.com",
                "l.facebook.com",
                "m.facebook.com",
                "facebook",
                "fb",
            }
        ),
        (".facebook.com",),
    ),
    ("x", frozenset({"t.co", "twitter.com", "x.com", "twitter"}), (".twitter.com", ".x.com")),
    ("line", frozenset({"line.me", "lin.ee", "line", "timeline.line.me"}), (".line.me",)),
)
# 表で other と明記された値。sns_source_unmapped には記録しない。
_KNOWN_OTHER: Final = frozenset({"threads", "threads.net"})


def normalize_sns_source(source: str) -> SnsResult:
    """区分を返す。どの規則にも当たらなければ `unmapped`（07 U-02）。"""
    value = source.strip().lower()
    for bucket, exact, suffixes in _RULES:
        if value in exact or value.endswith(suffixes):
            return bucket
    return "other" if value in _KNOWN_OTHER else "unmapped"


def to_sns_bucket(result: SnsResult) -> SnsBucket:
    """格納する 5 区分に直す。`unmapped` は `other` に数える。"""
    return "other" if result == "unmapped" else result
