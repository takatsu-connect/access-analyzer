"""U-13: 基準日からの期間の計算（03 §3、02 §2.2）。

period は date だけを受け取り、時刻もランナーのタイムゾーンも参照しない。
基準日そのものの決め方（Asia/Tokyo の前日）は test_tz.py で確かめる。
"""

from collections.abc import Iterable
from datetime import date, timedelta

import pytest

from takatsu_batch.config import WINDOW_DAYS, WINDOW_IDS
from takatsu_batch.period import (
    Period,
    chunked,
    month_id,
    month_periods,
    plan_periods,
    window_periods,
)

BASE = date(2026, 11, 4)
# 基準日 2026-11-04 のときの月（2025-10 から基準日の月まで）
ALL_MONTH_IDS = [
    "m2025-10",
    "m2025-11",
    "m2025-12",
    "m2026-01",
    "m2026-02",
    "m2026-03",
    "m2026-04",
    "m2026-05",
    "m2026-06",
    "m2026-07",
    "m2026-08",
    "m2026-09",
    "m2026-10",
    "m2026-11",
]
# そのうち確定している月（月末 + 7 ≤ 2026-11-04）。2026-10 は 11-07 に確定する
CONFIRMED_IDS = ALL_MONTH_IDS[:12]


def _ids(periods: Iterable[Period]) -> list[str]:
    return [period.period_id for period in periods]


def _without(ids: Iterable[str], *removed: str) -> list[str]:
    return [period_id for period_id in ids if period_id not in removed]


# --- 移動窓 ---


def test_window_periods_for_base_date() -> None:
    assert window_periods(BASE) == [
        Period("last7", "window", date(2026, 10, 29), date(2026, 11, 4), False),
        Period("prev7", "window", date(2026, 10, 22), date(2026, 10, 28), False),
        Period("last28", "window", date(2026, 10, 8), date(2026, 11, 4), False),
        Period("prev28", "window", date(2026, 9, 10), date(2026, 10, 7), False),
        Period("last90", "window", date(2026, 8, 7), date(2026, 11, 4), False),
        Period("prev90", "window", date(2026, 5, 9), date(2026, 8, 6), False),
    ]


@pytest.mark.parametrize(
    ("base_date", "period_id", "start_date", "end_date"),
    [
        # 年をまたぐ
        (date(2026, 1, 3), "last7", date(2025, 12, 28), date(2026, 1, 3)),
        (date(2026, 1, 3), "prev7", date(2025, 12, 21), date(2025, 12, 27)),
        (date(2026, 1, 1), "last7", date(2025, 12, 26), date(2026, 1, 1)),
        (date(2026, 1, 1), "last28", date(2025, 12, 5), date(2026, 1, 1)),
        # 月末をまたぐ（30 日の月、31 日の月）
        (date(2026, 10, 1), "last7", date(2026, 9, 25), date(2026, 10, 1)),
        (date(2026, 11, 1), "last7", date(2026, 10, 26), date(2026, 11, 1)),
        # 2 月をまたぐ（平年とうるう年）
        (date(2027, 3, 1), "last7", date(2027, 2, 23), date(2027, 3, 1)),
        (date(2028, 3, 1), "last7", date(2028, 2, 24), date(2028, 3, 1)),
        (date(2028, 3, 1), "prev7", date(2028, 2, 17), date(2028, 2, 23)),
    ],
)
def test_window_periods_across_month_and_year_ends(
    base_date: date, period_id: str, start_date: date, end_date: date
) -> None:
    by_id = {period.period_id: period for period in window_periods(base_date)}
    assert (by_id[period_id].start_date, by_id[period_id].end_date) == (start_date, end_date)


@pytest.mark.parametrize(
    "base_date",
    [date(2025, 10, 8), date(2026, 1, 1), date(2026, 11, 4), date(2026, 12, 31), date(2028, 2, 29)],
)
def test_window_periods_follow_config_order_and_lengths(base_date: date) -> None:
    periods = window_periods(base_date)
    assert _ids(periods) == list(WINDOW_IDS)
    assert all(period.kind == "window" and not period.is_confirmed for period in periods)
    by_id = {period.period_id: period for period in periods}
    for current_id, previous_id, days in WINDOW_DAYS:
        current, previous = by_id[current_id], by_id[previous_id]
        # last は基準日で終わる N 日、prev はその直前の N 日（すき間も重なりもない）
        assert current.end_date == base_date
        assert (current.end_date - current.start_date).days == days - 1
        assert previous.end_date == current.start_date - timedelta(days=1)
        assert (previous.end_date - previous.start_date).days == days - 1


# --- 月 ---


def test_month_id() -> None:
    assert month_id(2025, 10) == "m2025-10"
    assert month_id(2026, 1) == "m2026-01"
    assert month_id(2026, 12) == "m2026-12"


def test_month_periods_for_base_date() -> None:
    months = month_periods(BASE)
    assert _ids(months) == ALL_MONTH_IDS
    assert all(month.kind == "month" for month in months)
    # start_date は暦月の 1 日（2025-10 も 10-08 ではなく 10-01）
    assert all(month.start_date.day == 1 for month in months)
    assert months[0] == Period("m2025-10", "month", date(2025, 10, 1), date(2025, 10, 31), True)
    # 年またぎ、2 月
    assert months[2] == Period("m2025-12", "month", date(2025, 12, 1), date(2025, 12, 31), True)
    assert months[3] == Period("m2026-01", "month", date(2026, 1, 1), date(2026, 1, 31), True)
    assert months[4] == Period("m2026-02", "month", date(2026, 2, 1), date(2026, 2, 28), True)
    assert months[11] == Period("m2026-09", "month", date(2026, 9, 1), date(2026, 9, 30), True)
    # 前月は月末 + 7（11-07）に達していないので未確定
    assert months[12] == Period("m2026-10", "month", date(2026, 10, 1), date(2026, 10, 31), False)
    # 基準日の属する月の end_date は基準日
    assert months[13] == Period("m2026-11", "month", date(2026, 11, 1), date(2026, 11, 4), False)
    assert _ids(month for month in months if month.is_confirmed) == CONFIRMED_IDS


@pytest.mark.parametrize(
    ("base_date", "period_id", "expected"),
    [
        # 月末 + 7 と等しい日で true、1 日前で false
        (date(2026, 11, 6), "m2026-10", False),
        (date(2026, 11, 7), "m2026-10", True),
        (date(2026, 11, 8), "m2026-10", True),
        # 30 日の月
        (date(2026, 10, 6), "m2026-09", False),
        (date(2026, 10, 7), "m2026-09", True),
        # 年またぎ
        (date(2026, 1, 6), "m2025-12", False),
        (date(2026, 1, 7), "m2025-12", True),
        # 2 月（平年とうるう年）。どちらも 3 月 7 日に確定する
        (date(2027, 3, 6), "m2027-02", False),
        (date(2027, 3, 7), "m2027-02", True),
        (date(2028, 3, 6), "m2028-02", False),
        (date(2028, 3, 7), "m2028-02", True),
        # 基準日の属する月は月末日でも未確定
        (date(2026, 10, 31), "m2026-10", False),
        # 計測開始の月
        (date(2025, 11, 6), "m2025-10", False),
        (date(2025, 11, 7), "m2025-10", True),
    ],
)
def test_month_is_confirmed_boundary(base_date: date, period_id: str, expected: bool) -> None:
    by_id = {month.period_id: month for month in month_periods(base_date)}
    assert by_id[period_id].is_confirmed is expected


def test_month_periods_across_year_end() -> None:
    assert month_periods(date(2026, 1, 7)) == [
        Period("m2025-10", "month", date(2025, 10, 1), date(2025, 10, 31), True),
        Period("m2025-11", "month", date(2025, 11, 1), date(2025, 11, 30), True),
        Period("m2025-12", "month", date(2025, 12, 1), date(2025, 12, 31), True),
        Period("m2026-01", "month", date(2026, 1, 1), date(2026, 1, 7), False),
    ]


def test_month_periods_on_backfill_start_day() -> None:
    assert month_periods(date(2025, 10, 8)) == [
        Period("m2025-10", "month", date(2025, 10, 1), date(2025, 10, 8), False),
    ]


def test_month_periods_in_leap_february() -> None:
    months = month_periods(date(2028, 3, 7))
    assert months[-2] == Period("m2028-02", "month", date(2028, 2, 1), date(2028, 2, 29), True)
    assert months[-1] == Period("m2028-03", "month", date(2028, 3, 1), date(2028, 3, 7), False)


# --- 取り直す期間 ---


def test_plan_on_ordinary_day_refetches_windows_and_unconfirmed_months() -> None:
    plan = plan_periods(
        BASE,
        prior_confirmed=CONFIRMED_IDS,
        referrer_months=CONFIRMED_IDS,
        city_months=CONFIRMED_IDS,
        full=False,
    )
    assert plan.base_date == BASE
    assert plan.refetch[:6] == tuple(window_periods(BASE))
    assert _ids(plan.refetch) == [*WINDOW_IDS, "m2026-10", "m2026-11"]
    assert _ids(plan.all_periods) == [*WINDOW_IDS, *ALL_MONTH_IDS]
    assert plan.all_periods == (*window_periods(BASE), *month_periods(BASE))
    assert plan.referrer_months == ()
    assert plan.city_months == ()
    assert plan.city_extra_months == ()


def test_plan_on_the_day_a_month_becomes_confirmed() -> None:
    # 2026-10 は基準日 11-07 で確定する。その実行で最後に取り直し、参照元と市別を取る
    plan = plan_periods(
        date(2026, 11, 7),
        prior_confirmed=CONFIRMED_IDS,
        referrer_months=CONFIRMED_IDS,
        city_months=CONFIRMED_IDS,
        full=False,
    )
    assert _ids(plan.refetch) == [*WINDOW_IDS, "m2026-10", "m2026-11"]
    assert plan.refetch[6].is_confirmed is True
    assert plan.refetch[7].is_confirmed is False
    assert _ids(plan.referrer_months) == ["m2026-10"]
    assert _ids(plan.city_months) == ["m2026-10"]
    assert plan.city_extra_months == ()


def test_plan_does_not_touch_a_month_after_it_was_confirmed() -> None:
    confirmed = [*CONFIRMED_IDS, "m2026-10"]
    plan = plan_periods(
        date(2026, 11, 8),
        prior_confirmed=confirmed,
        referrer_months=confirmed,
        city_months=confirmed,
        full=False,
    )
    assert _ids(plan.refetch) == [*WINDOW_IDS, "m2026-11"]
    assert _ids(plan.all_periods) == [*WINDOW_IDS, *ALL_MONTH_IDS]
    assert plan.referrer_months == ()
    assert plan.city_months == ()
    assert plan.city_extra_months == ()


def test_plan_fills_confirmed_months_without_referrer_or_city_rows() -> None:
    # 確定済みで取り直さない月のうち、行がない月だけを補う。市別は extra として取り直す
    plan = plan_periods(
        BASE,
        prior_confirmed=CONFIRMED_IDS,
        referrer_months=_without(CONFIRMED_IDS, "m2026-03"),
        city_months=_without(CONFIRMED_IDS, "m2026-05", "m2025-12"),
        full=False,
    )
    assert _ids(plan.refetch) == [*WINDOW_IDS, "m2026-10", "m2026-11"]
    assert _ids(plan.referrer_months) == ["m2026-03"]
    assert _ids(plan.city_months) == ["m2025-12", "m2026-05"]
    assert _ids(plan.city_extra_months) == ["m2025-12", "m2026-05"]


def test_plan_refetches_confirmed_month_missing_from_prior() -> None:
    # 確定の記録がない確定月（前回が失敗した場合）は取り直す。refetch に入るので extra ではない
    plan = plan_periods(
        BASE,
        prior_confirmed=_without(CONFIRMED_IDS, "m2026-09"),
        referrer_months=_without(CONFIRMED_IDS, "m2026-09"),
        city_months=_without(CONFIRMED_IDS, "m2026-09"),
        full=False,
    )
    assert _ids(plan.refetch) == [*WINDOW_IDS, "m2026-09", "m2026-10", "m2026-11"]
    assert _ids(plan.referrer_months) == ["m2026-09"]
    assert _ids(plan.city_months) == ["m2026-09"]
    assert plan.city_extra_months == ()


def test_plan_stores_cities_of_refetched_confirmed_month_even_if_rows_exist() -> None:
    plan = plan_periods(
        BASE,
        prior_confirmed=_without(CONFIRMED_IDS, "m2026-09"),
        referrer_months=CONFIRMED_IDS,
        city_months=CONFIRMED_IDS,
        full=False,
    )
    assert _ids(plan.refetch) == [*WINDOW_IDS, "m2026-09", "m2026-10", "m2026-11"]
    assert plan.referrer_months == ()
    assert _ids(plan.city_months) == ["m2026-09"]
    assert plan.city_extra_months == ()


def test_plan_full_refetches_every_month() -> None:
    plan = plan_periods(
        BASE,
        prior_confirmed=CONFIRMED_IDS,
        referrer_months=CONFIRMED_IDS,
        city_months=CONFIRMED_IDS,
        full=True,
    )
    assert _ids(plan.refetch) == [*WINDOW_IDS, *ALL_MONTH_IDS]
    assert plan.refetch == plan.all_periods
    # 参照元と市別は確定月だけ（未確定の 2026-10、2026-11 は入らない）
    assert _ids(plan.referrer_months) == CONFIRMED_IDS
    assert _ids(plan.city_months) == CONFIRMED_IDS
    assert plan.city_extra_months == ()


def test_plan_first_run_without_prior_state() -> None:
    plan = plan_periods(BASE, prior_confirmed=[], referrer_months=[], city_months=[], full=False)
    assert _ids(plan.refetch) == [*WINDOW_IDS, *ALL_MONTH_IDS]
    assert _ids(plan.referrer_months) == CONFIRMED_IDS
    assert _ids(plan.city_months) == CONFIRMED_IDS
    assert plan.city_extra_months == ()


@pytest.mark.parametrize("full", [False, True])
@pytest.mark.parametrize(
    ("prior_confirmed", "city_months"),
    [
        ([], []),
        (CONFIRMED_IDS, CONFIRMED_IDS),
        (CONFIRMED_IDS, []),
        (CONFIRMED_IDS[:6], CONFIRMED_IDS[3:9]),
    ],
)
def test_plan_city_extra_months_are_city_months_outside_refetch(
    prior_confirmed: list[str], city_months: list[str], full: bool
) -> None:
    plan = plan_periods(
        BASE,
        prior_confirmed=prior_confirmed,
        referrer_months=[],
        city_months=city_months,
        full=full,
    )
    refetch_ids = set(_ids(plan.refetch))
    assert _ids(plan.city_extra_months) == [
        period_id for period_id in _ids(plan.city_months) if period_id not in refetch_ids
    ]
    assert all(month.is_confirmed for month in (*plan.city_months, *plan.referrer_months))


def test_plan_is_the_same_when_run_again() -> None:
    def run() -> object:
        return plan_periods(
            BASE,
            prior_confirmed=CONFIRMED_IDS,
            referrer_months=_without(CONFIRMED_IDS, "m2026-03"),
            city_months=_without(CONFIRMED_IDS, "m2026-05"),
            full=False,
        )

    assert run() == run()


# --- 分割 ---


@pytest.mark.parametrize(
    ("items", "size", "expected"),
    [
        ([1, 2, 3, 4, 5], 2, [[1, 2], [3, 4], [5]]),
        ([1, 2, 3, 4], 2, [[1, 2], [3, 4]]),
        ([1, 2, 3], 5, [[1, 2, 3]]),
        ([1, 2, 3], 1, [[1], [2], [3]]),
        ([], 3, []),
    ],
)
def test_chunked(items: list[int], size: int, expected: list[list[int]]) -> None:
    assert [list(chunk) for chunk in chunked(items, size)] == expected
