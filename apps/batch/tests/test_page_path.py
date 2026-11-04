"""U-01: pagePath の正規化（03 §5.1）。"""

import pytest

from takatsu_batch.page_path import classify_page_path, extract_post_id, normalize_page_path


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("/4812/", "/4812/"),
        ("/4812", "/4812/"),
        ("  /ABC/Def  ", "/abc/def/"),
        ("//4812//", "/4812/"),
        ("/4812/?utm_source=x", "/4812/"),
        ("/4812?utm_source=x", "/4812/"),
        ("/4812/#top", "/4812/"),
        ("/?p=4812", "/"),
        ("/", "/"),
        ("", "/"),
        ("/4812 ?a=1", "/4812/"),
        (" /4812/ #top", "/4812/"),
        ("  ", "/"),
    ],
)
def test_normalize(raw: str, expected: str) -> None:
    assert normalize_page_path(raw) == expected


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("/4812/", 4812),
        ("/4812", 4812),
        (" //4812// ", 4812),
        ("/4812/?a=1", 4812),
        ("/2147483647/", 2147483647),
        ("/", None),
        ("/?p=4812", None),
        ("/category/news/", None),
        ("/tag/x/", None),
        ("/author/foo/", None),
        ("/about/", None),
        ("/4812/2/", None),
        ("/4812/amp/", None),
        ("/4812/feed/", None),
        ("/abc123/", None),
        ("/-1/", None),
        ("/2147483648/", None),
        ("/4812 ?a=1", 4812),
        ("/04812/", None),
        ("/00123/", None),
        ("/0/", None),
        ("/12345678901/", None),
        (f"/{'9' * 5000}/", None),
        ("/١٢٣/", None),
    ],
)
def test_extract_post_id(raw: str, expected: int | None) -> None:
    assert extract_post_id(raw) == expected


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("/10/", "article"),
        ("/11/", "unknown_article"),
        ("/category/news/", "non_article"),
        ("/10/2/", "non_article"),
    ],
)
def test_classify(raw: str, expected: str) -> None:
    assert classify_page_path(raw, {10}) == expected
