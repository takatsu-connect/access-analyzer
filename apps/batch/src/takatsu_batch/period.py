"""基準日と期間（03 §3、02 §2.2）。"""

from calendar import monthrange
from collections.abc import Iterable, Iterator, Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

from takatsu_batch.config import BACKFILL_START, CONFIRM_DELAY_DAYS, WINDOW_DAYS

type PeriodKind = Literal["window", "month"]


@dataclass(frozen=True, slots=True)
class Period:
    period_id: str
    kind: PeriodKind
    start_date: date
    end_date: date
    is_confirmed: bool


@dataclass(frozen=True, slots=True)
class PeriodPlan:
    """今回の period の扱い。

    - refetch: period に書く行 = 取り直す期間（移動窓 + まだ確定していなかった月）。
    - all_periods: period の全行（取り直さない確定月を含む）。
    - referrer_months: 参照元ドメインを取得する確定月（§3 の「行がない確定月を補う」を含む）。
    - city_months: 市別を格納する確定月。そのうち city_extra_months は refetch に入らないので
      市別だけを取り直す。
    """

    base_date: date
    refetch: tuple[Period, ...]
    all_periods: tuple[Period, ...]
    referrer_months: tuple[Period, ...]
    city_months: tuple[Period, ...]
    city_extra_months: tuple[Period, ...]


def month_id(year: int, month: int) -> str:
    return f"m{year:04d}-{month:02d}"


def window_periods(base_date: date) -> list[Period]:
    """移動窓 6 つ。last = [基準日 − (N−1), 基準日]、prev = その前の N 日。"""
    periods: list[Period] = []
    for current_id, previous_id, days in WINDOW_DAYS:
        current_start = base_date - timedelta(days=days - 1)
        previous_end = current_start - timedelta(days=1)
        periods.append(Period(current_id, "window", current_start, base_date, False))
        periods.append(
            Period(
                previous_id,
                "window",
                previous_end - timedelta(days=days - 1),
                previous_end,
                False,
            )
        )
    return periods


def _months_between(start: date, end: date) -> Iterator[tuple[int, int]]:
    year, month = start.year, start.month
    while (year, month) <= (end.year, end.month):
        yield year, month
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)


def month_periods(base_date: date) -> list[Period]:
    """計測開始の月から基準日の属する月まで。基準日の属する月の end_date は基準日。

    start_date は暦月の 1 日にする。2025-10 は 10-08 からのデータしかないが、公開本数は
    1 日から数えるため（02 §4 の公開本数のビュー）。
    """
    months: list[Period] = []
    for year, month in _months_between(date.fromisoformat(BACKFILL_START), base_date):
        last_day = date(year, month, monthrange(year, month)[1])
        months.append(
            Period(
                month_id(year, month),
                "month",
                date(year, month, 1),
                min(last_day, base_date),
                last_day + timedelta(days=CONFIRM_DELAY_DAYS) <= base_date,
            )
        )
    return months


def plan_periods(
    base_date: date,
    *,
    prior_confirmed: Iterable[str],
    referrer_months: Iterable[str],
    city_months: Iterable[str],
    full: bool,
) -> PeriodPlan:
    """取り直す期間を決める。確定済みの月は触らない（full のときだけ全部）。"""
    confirmed_before = frozenset(prior_confirmed)
    with_referrers = frozenset(referrer_months)
    with_cities = frozenset(city_months)
    months = month_periods(base_date)
    refetch_months = [m for m in months if full or m.period_id not in confirmed_before]
    refetch_ids = {m.period_id for m in refetch_months}
    confirmed = [m for m in months if m.is_confirmed]
    return PeriodPlan(
        base_date=base_date,
        refetch=(*window_periods(base_date), *refetch_months),
        all_periods=(*window_periods(base_date), *months),
        referrer_months=tuple(m for m in confirmed if full or m.period_id not in with_referrers),
        city_months=tuple(
            m
            for m in confirmed
            if full or m.period_id in refetch_ids or m.period_id not in with_cities
        ),
        city_extra_months=tuple(
            m
            for m in confirmed
            if m.period_id not in refetch_ids and m.period_id not in with_cities
        ),
    )


def chunked[T](items: Sequence[T], size: int) -> Iterator[Sequence[T]]:
    for start in range(0, len(items), size):
        yield items[start : start + size]
