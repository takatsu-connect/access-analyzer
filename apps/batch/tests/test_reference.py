"""U-07、U-08: 分布と帯の参照実装。"""

from datetime import date, timedelta

import pytest

from support.reference import PopulationEntry, Quantiles, band, curve_point, quantiles

BASE = date(2026, 11, 1)


def test_quantiles_linear_interpolation() -> None:
    assert quantiles([1, 2, 3, 4], minimum=1) == Quantiles(1.75, 2.5, 3.25)
    assert quantiles([10], minimum=1) == Quantiles(10, 10, 10)


def test_quantiles_needs_minimum_population() -> None:
    assert quantiles(list(range(29))) is None
    result = quantiles(list(range(30)))
    assert result == Quantiles(7.25, 14.5, 21.75)
    assert quantiles([], minimum=0) is None


def _entries(count: int, published_on: date) -> list[PopulationEntry]:
    return [PopulationEntry(published_on, index) for index in range(count)]


def test_curve_uses_12m_when_enough() -> None:
    entries = _entries(30, BASE - timedelta(days=365)) + _entries(5, BASE - timedelta(days=366))
    point = curve_point(entries, BASE)
    assert point is not None
    assert (point.population_size, point.population_window) == (30, "12m")


def test_curve_widens_to_all_when_12m_is_short() -> None:
    entries = _entries(29, BASE - timedelta(days=10)) + _entries(1, BASE - timedelta(days=366))
    point = curve_point(entries, BASE)
    assert point is not None
    assert (point.population_size, point.population_window) == (30, "all")


def test_curve_has_no_point_when_all_is_short() -> None:
    assert curve_point(_entries(29, BASE), BASE) is None


CURVE = Quantiles(10, 20, 30)


@pytest.mark.parametrize(
    ("value", "curve", "age_days", "expected"),
    [
        (31, CURVE, 3, "upper"),
        (30, CURVE, 3, "middle"),
        (20, CURVE, 3, "middle"),
        (10, CURVE, 3, "middle"),
        (9, CURVE, 3, "lower"),
        (31, CURVE, 2, None),
        (31, None, 30, None),
        (None, CURVE, 30, None),
    ],
)
def test_band(value: int | None, curve: Quantiles | None, age_days: int, expected: str) -> None:
    assert band(value, curve, age_days) == expected
