"""U-04、U-05、U-27: 伏せ値、二次伏せ、階層差分（03 §6.1）。"""

from collections.abc import Sequence

import pytest

from takatsu_batch.config import CHANNEL_BUCKETS, HEATMAP_BUCKETS, SNS_BUCKETS
from takatsu_batch.mask import (
    MaskedCell,
    apply_author_hierarchy_mask,
    apply_mask,
    apply_secondary_mask,
    mask_exclusive,
    mask_value,
    top_n_above_threshold,
)

T = 5
BUCKETS = ("a", "b", "c", "d")


def _as_tuples[B](cells: Sequence[MaskedCell[B]]) -> list[tuple[B, int | None, str | None]]:
    return [(cell.bucket, cell.value, cell.mask) for cell in cells]


@pytest.mark.parametrize(
    ("value", "expected_value", "expected_mask"),
    [
        (0, 0, None),
        (1, None, "threshold"),
        (4, None, "threshold"),
        (5, 5, None),
        (100, 100, None),
    ],
)
def test_mask_value(value: int, expected_value: int | None, expected_mask: str | None) -> None:
    cell = mask_value("a", value, T)
    assert (cell.value, cell.mask) == (expected_value, expected_mask)


def test_apply_mask_fills_missing_buckets_with_zero_and_keeps_order() -> None:
    assert _as_tuples(apply_mask({"c": 3, "a": 7}, BUCKETS, T)) == [
        ("a", 7, None),
        ("b", 0, None),
        ("c", None, "threshold"),
        ("d", 0, None),
    ]


def test_apply_mask_rejects_unknown_bucket_without_exposing_it() -> None:
    with pytest.raises(ValueError) as excinfo:
        apply_mask({"secret-domain.example": 9}, BUCKETS, T)
    assert "secret-domain" not in str(excinfo.value)


def test_apply_mask_rejects_duplicate_buckets() -> None:
    with pytest.raises(ValueError, match="unique"):
        apply_mask({}, ("a", "a"), T)


def test_negative_value_is_rejected() -> None:
    with pytest.raises(ValueError, match="negative"):
        mask_value("a", -1, T)


@pytest.mark.parametrize("threshold", [0, -1])
def test_threshold_must_be_positive(threshold: int) -> None:
    with pytest.raises(ValueError, match="threshold"):
        mask_value("a", 1, threshold)
    with pytest.raises(ValueError, match="threshold"):
        apply_secondary_mask([], threshold)
    with pytest.raises(ValueError, match="threshold"):
        top_n_above_threshold([1], lambda row: row, 1, threshold)


def test_secondary_masks_smallest_cell_at_or_above_threshold() -> None:
    assert _as_tuples(mask_exclusive({"a": 3, "b": 9, "c": 6, "d": 20}, BUCKETS, T)) == [
        ("a", None, "threshold"),
        ("b", 9, None),
        ("c", None, "secondary"),
        ("d", 20, None),
    ]


def test_secondary_skips_zero_cells() -> None:
    # 0 を候補にすると、伏せた 2 セルの和から値が分かる（M-1）
    assert _as_tuples(mask_exclusive({"a": 3, "c": 8}, BUCKETS, T)) == [
        ("a", None, "threshold"),
        ("b", 0, None),
        ("c", None, "secondary"),
        ("d", 0, None),
    ]


def test_secondary_not_added_when_no_candidate() -> None:
    # 07 U-05 の例: {a: 3, b: 0, c: 0} は a だけを伏せる
    assert _as_tuples(mask_exclusive({"a": 3, "b": 0, "c": 0}, ("a", "b", "c"), T)) == [
        ("a", None, "threshold"),
        ("b", 0, None),
        ("c", 0, None),
    ]


def test_secondary_tie_uses_fixed_bucket_order() -> None:
    first = mask_exclusive({"a": 1, "b": 7, "c": 7, "d": 7}, BUCKETS, T)
    second = mask_exclusive({"d": 7, "c": 7, "b": 7, "a": 1}, BUCKETS, T)
    assert _as_tuples(first) == _as_tuples(second)
    assert first[1].mask == "secondary"
    assert first[2].mask is None


@pytest.mark.parametrize(
    "raw",
    [
        {"a": 10, "b": 20, "c": 0, "d": 5},
        {"a": 1, "b": 2, "c": 30, "d": 40},
        {"a": 1, "b": 2, "c": 3, "d": 40},
    ],
)
def test_secondary_does_nothing_for_zero_or_two_or_more_masked(raw: dict[str, int]) -> None:
    masks = [cell.mask for cell in mask_exclusive(raw, BUCKETS, T)]
    assert "secondary" not in masks


def test_threshold_cell_of_exactly_t_is_a_candidate() -> None:
    cells = mask_exclusive({"a": 4, "b": 5, "c": 6}, ("a", "b", "c"), T)
    assert cells[1].mask == "secondary"


def test_heatmap_168_cells_uses_same_rule() -> None:
    raw = dict.fromkeys(HEATMAP_BUCKETS, 50)
    raw[(0, 0)] = 2
    raw[(3, 12)] = 6
    cells = mask_exclusive(raw, HEATMAP_BUCKETS, T)
    assert len(cells) == 168
    masked = {cell.bucket: cell.mask for cell in cells if cell.mask}
    assert masked == {(0, 0): "threshold", (3, 12): "secondary"}


def test_top_n_drops_below_threshold_before_taking_n() -> None:
    rows = [("a", 3), ("b", 50), ("c", 5), ("d", 9), ("e", 9), ("f", 4)]
    assert top_n_above_threshold(rows, lambda row: row[1], 3, T) == [
        ("b", 50),
        ("d", 9),
        ("e", 9),
    ]
    assert top_n_above_threshold(rows, lambda row: row[1], 10, T) == [
        ("b", 50),
        ("d", 9),
        ("e", 9),
        ("c", 5),
    ]


def _author(raw: dict[str, int]) -> list[MaskedCell[str]]:
    return mask_exclusive(raw, SNS_BUCKETS, T)


def test_hierarchy_u27_fixture() -> None:
    # 07 U-27: 記事 3 本のうち 1 本だけ instagram が 4 → 著者の instagram が伏さり、
    # 著者の区分で伏せが 1 つになるので、次に小さい T 以上のセルも伏さる
    author = _author({"instagram": 20, "facebook": 30, "x": 10, "line": 0, "other": 50})
    articles = [
        mask_exclusive({"instagram": 4, "facebook": 0}, SNS_BUCKETS, T),
        mask_exclusive({"instagram": 8, "facebook": 15, "x": 5}, SNS_BUCKETS, T),
        mask_exclusive({"instagram": 8, "facebook": 15, "x": 5, "other": 50}, SNS_BUCKETS, T),
    ]
    assert _as_tuples(apply_author_hierarchy_mask(author, articles, T)) == [
        ("instagram", None, "secondary"),
        ("facebook", 30, None),
        ("x", None, "secondary"),
        ("line", 0, None),
        ("other", 50, None),
    ]


def test_hierarchy_counts_secondary_article_cells() -> None:
    # 記事の instagram は threshold、facebook は secondary。どちらも 1 本だけなので著者も伏せる
    author = _author({"instagram": 20, "facebook": 30, "x": 40, "line": 0, "other": 0})
    article = mask_exclusive({"instagram": 4, "facebook": 7, "x": 40}, SNS_BUCKETS, T)
    assert article[1].mask == "secondary"
    result = apply_author_hierarchy_mask(author, [article], T)
    assert [cell.mask for cell in result] == ["secondary", "secondary", None, None, None]


def test_hierarchy_zero_masked_articles_changes_nothing() -> None:
    author = _author({"instagram": 20, "facebook": 30})
    article = mask_exclusive({"instagram": 20, "facebook": 30}, SNS_BUCKETS, T)
    assert apply_author_hierarchy_mask(author, [article], T) == author


def test_hierarchy_two_masked_articles_changes_nothing() -> None:
    author = _author({"instagram": 8, "facebook": 30})
    articles = [
        [MaskedCell("instagram", None, "threshold")],
        [MaskedCell("instagram", None, "threshold")],
    ]
    assert apply_author_hierarchy_mask(author, articles, T) == author


def test_hierarchy_keeps_existing_threshold_mask() -> None:
    # 著者セルが既に threshold なら、種別を secondary に変えない
    author = _author({"instagram": 3, "facebook": 30, "x": 40})
    assert author[1].mask == "secondary"
    articles = [[MaskedCell("instagram", None, "threshold")]]
    result = apply_author_hierarchy_mask(author, articles, T)
    assert result == author


def test_hierarchy_no_rerun_when_two_or_more_masked_after_step5() -> None:
    author = _author({"instagram": 20, "facebook": 30, "x": 40, "line": 50})
    articles = [
        [MaskedCell("instagram", None, "threshold"), MaskedCell("facebook", None, "secondary")],
    ]
    result = apply_author_hierarchy_mask(author, articles, T)
    assert [cell.mask for cell in result] == ["secondary", "secondary", None, None, None]


def test_hierarchy_rejects_unknown_bucket() -> None:
    with pytest.raises(ValueError, match="unknown bucket"):
        apply_author_hierarchy_mask(
            mask_exclusive({"search": 10}, CHANNEL_BUCKETS, T),
            [[MaskedCell("instagram", None, "threshold")]],
            T,
        )
