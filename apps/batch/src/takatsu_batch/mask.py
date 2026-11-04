"""伏せ値、二次伏せ、著者 × 内訳軸の階層差分（03 §6.1、ADR 0003 判断 2、D-16）。

例外のメッセージは固定の文にする。値やバケット名を入れない（03 §14）。
"""

from collections.abc import Callable, Hashable, Iterable, Mapping, Sequence
from dataclasses import dataclass, replace
from typing import Literal

type MaskKind = Literal["threshold", "secondary"]


@dataclass(frozen=True, slots=True)
class MaskedCell[B: Hashable]:
    """1 セルの結果。伏せたときは value が None で、mask に理由が入る。"""

    bucket: B
    value: int | None
    mask: MaskKind | None = None


def _check_threshold(threshold: int) -> None:
    if threshold < 1:
        raise ValueError("threshold must be positive")


def _check_value(value: int) -> None:
    if value < 0:
        raise ValueError("cell value must not be negative")


def mask_value[B: Hashable](bucket: B, value: int, threshold: int) -> MaskedCell[B]:
    """手順 2: `1 ≤ 値 < T` を `threshold` で伏せる。0 は伏せない。単独値にはこれだけを使う。"""
    _check_threshold(threshold)
    _check_value(value)
    if 1 <= value < threshold:
        return MaskedCell(bucket, None, "threshold")
    return MaskedCell(bucket, value)


def apply_mask[B: Hashable](
    raw: Mapping[B, int], buckets: Sequence[B], threshold: int
) -> list[MaskedCell[B]]:
    """手順 1・2: 全バケットを固定の順に揃え（返らなかったものは 0）、T 未満を伏せる。"""
    if len(set(buckets)) != len(buckets):
        raise ValueError("buckets must be unique")
    if not set(raw) <= set(buckets):
        raise ValueError("unknown bucket in input")
    return [mask_value(bucket, raw.get(bucket, 0), threshold) for bucket in buckets]


def apply_secondary_mask[B: Hashable](
    cells: Sequence[MaskedCell[B]], threshold: int
) -> list[MaskedCell[B]]:
    """手順 3: 伏せたセルがちょうど 1 つなら、T 以上で最小のセル（同値は先のもの）も伏せる。

    0 と T 未満のセルは候補にしない。候補がなければ追加しない。
    """
    _check_threshold(threshold)
    if sum(cell.mask is not None for cell in cells) != 1:
        return list(cells)
    candidates = [
        index
        for index, cell in enumerate(cells)
        if cell.mask is None and cell.value is not None and cell.value >= threshold
    ]
    if not candidates:
        return list(cells)
    # min は同値のとき先頭を返すので、区分順で安定する
    target = min(candidates, key=_value_at(cells))
    result = list(cells)
    result[target] = MaskedCell(cells[target].bucket, None, "secondary")
    return result


def _value_at[B: Hashable](cells: Sequence[MaskedCell[B]]) -> Callable[[int], int]:
    def value_at(index: int) -> int:
        value = cells[index].value
        return 0 if value is None else value

    return value_at


def mask_exclusive[B: Hashable](
    raw: Mapping[B, int], buckets: Sequence[B], threshold: int
) -> list[MaskedCell[B]]:
    """排他的な区分に手順 1〜3 を適用する。曜日 × 時間帯の 168 セルにも同じものを使う（手順 4）。"""
    return apply_secondary_mask(apply_mask(raw, buckets, threshold), threshold)


def apply_author_hierarchy_mask[B: Hashable](
    author_cells: Sequence[MaskedCell[B]],
    article_cells: Iterable[Sequence[MaskedCell[B]]],
    threshold: int,
) -> list[MaskedCell[B]]:
    """手順 5: 著者 1 人 × 期間 × 軸 の階層差分。

    author_cells は手順 1〜3 の適用後、article_cells はその著者の記事ごとの同じ期間・軸のセル
    （手順 1〜3 の適用後）。同じバケットで伏せた記事セルがちょうど 1 本なら著者セルも伏せ、
    その結果について手順 3 を判定し直す。
    """
    masked_articles: dict[B, int] = {}
    known = {cell.bucket for cell in author_cells}
    for cells in article_cells:
        for cell in cells:
            if cell.bucket not in known:
                raise ValueError("unknown bucket in article cells")
            if cell.mask is not None:
                masked_articles[cell.bucket] = masked_articles.get(cell.bucket, 0) + 1

    result = [
        replace(cell, value=None, mask="secondary")
        if cell.mask is None and masked_articles.get(cell.bucket, 0) == 1
        else cell
        for cell in author_cells
    ]
    return apply_secondary_mask(result, threshold)


def top_n_above_threshold[R](
    rows: Iterable[R], sessions: Callable[[R], int], n: int, threshold: int
) -> list[R]:
    """手順 4: 参照元ドメイン・市別の上位 N。T 未満の行を落としてから、多い順に N 行を取る。

    同値は入力の順に従う（安定ソート）。
    """
    _check_threshold(threshold)
    kept = [row for row in rows if sessions(row) >= threshold]
    return sorted(kept, key=sessions, reverse=True)[:n]
