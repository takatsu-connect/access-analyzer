"""分布と帯の参照実装（03 §6.2、07 U-07、U-08）。公開ビューの結果と突き合わせるために使う。"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

MIN_POPULATION = 30
MIN_BAND_AGE_DAYS = 3

type Band = Literal["upper", "middle", "lower"]


@dataclass(frozen=True, slots=True)
class Quantiles:
    p25: float
    p50: float
    p75: float


@dataclass(frozen=True, slots=True)
class CurvePoint:
    quantiles: Quantiles
    population_size: int
    population_window: Literal["12m", "all"]


@dataclass(frozen=True, slots=True)
class PopulationEntry:
    published_on: date
    value: int


def _percentile_cont(sorted_values: Sequence[int], fraction: float) -> float:
    """Postgres の percentile_cont と同じ線形補間。"""
    position = fraction * (len(sorted_values) - 1)
    lower = int(position)
    upper = min(lower + 1, len(sorted_values) - 1)
    weight = position - lower
    return sorted_values[lower] + (sorted_values[upper] - sorted_values[lower]) * weight


def quantiles(values: Sequence[int], minimum: int = MIN_POPULATION) -> Quantiles | None:
    """p25 / p50 / p75。母集団が minimum 未満なら None。"""
    if len(values) < minimum or not values:
        return None
    ordered = sorted(values)
    return Quantiles(
        _percentile_cont(ordered, 0.25),
        _percentile_cont(ordered, 0.5),
        _percentile_cont(ordered, 0.75),
    )


def curve_point(
    entries: Sequence[PopulationEntry], base_date: date, minimum: int = MIN_POPULATION
) -> CurvePoint | None:
    """(scope, n) の 1 行。12 か月で足りなければ全期間に広げ、それでも足りなければ None。"""
    cutoff = base_date - timedelta(days=365)
    recent = [entry.value for entry in entries if entry.published_on >= cutoff]
    recent_quantiles = quantiles(recent, minimum)
    if recent_quantiles is not None:
        return CurvePoint(recent_quantiles, len(recent), "12m")
    every = [entry.value for entry in entries]
    all_quantiles = quantiles(every, minimum)
    if all_quantiles is not None:
        return CurvePoint(all_quantiles, len(every), "all")
    return None


def band(value: float | None, curve: Quantiles | None, age_days: int) -> Band | None:
    """p75 と等しいときも p25 と等しいときも middle。age < 3、曲線なし、値なしは None。"""
    if age_days < MIN_BAND_AGE_DAYS or curve is None or value is None:
        return None
    if value > curve.p75:
        return "upper"
    if value < curve.p25:
        return "lower"
    return "middle"
