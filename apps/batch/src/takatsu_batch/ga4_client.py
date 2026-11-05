"""GA4 Data API の問い合わせの定義と実行（03 §5、§5.4、§11）。

問い合わせは G1〜G17、G19、G20 の 19 種に限る。定義は GA4_QUERIES に集める（07 U-22）。
同時実行はしない。リクエスト間に 200 ms 空け、429 は 60 秒待って 1 回だけ再試行する。
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import date
from typing import Final, Protocol

from google.analytics.data_v1beta.types import (
    DateRange,
    Dimension,
    Filter,
    FilterExpression,
    FilterExpressionList,
    Metric,
    RunReportRequest,
    RunReportResponse,
)
from google.api_core import exceptions as google_api
from pydantic import SecretStr

from takatsu_batch.config import (
    GA4_MIN_PROJECT_HOUR_TOKENS,
    GA4_QUOTA_RETRY_WAIT_SECONDS,
    GA4_REQUEST_INTERVAL_MS,
    GA4_REQUEST_TIMEOUT_SECONDS,
    GA4_ROW_LIMIT,
    GA4_SERVER_ERROR_RETRY_WAIT_SECONDS,
)
from takatsu_batch.errors import BatchQuotaError

_DATE_RANGE_DIMENSION: Final = "dateRange"
CHANNEL_DIMENSION: Final = "sessionDefaultChannelGroup"


class Ga4Api(Protocol):
    """BetaAnalyticsDataClient のうち使うものだけ。テストは偽物に差し替える。"""

    def run_report(
        self, request: RunReportRequest, *, timeout: float
    ) -> RunReportResponse: ...  # pragma: no cover


@dataclass(frozen=True, slots=True)
class QuerySpec:
    dimensions: tuple[str, ...]
    metrics: tuple[str, ...]
    channel_filter: str | None = None
    event_filter: str | None = None


# 03 §5.4 の一覧。G17 は landingPage のフィルタを実行時に足す
GA4_QUERIES: Final[dict[str, QuerySpec]] = {
    "G1": QuerySpec(("date",), ("screenPageViews", "sessions")),
    "G2": QuerySpec(("date", CHANNEL_DIMENSION), ("sessions",)),
    "G3": QuerySpec(("date", "deviceCategory"), ("screenPageViews", "sessions")),
    "G4": QuerySpec(("date", "pagePath"), ("screenPageViews",)),
    "G5": QuerySpec((), ("activeUsers", "userEngagementDuration")),
    "G6": QuerySpec(("newVsReturning",), ("activeUsers",)),
    "G7": QuerySpec(("sessionSource",), ("sessions",), channel_filter="Organic Social"),
    "G8": QuerySpec(("dayOfWeek", "hour"), ("screenPageViews",)),
    "G9": QuerySpec(("country", "region", "city"), ("sessions",)),
    "G10": QuerySpec(("landingPage",), ("sessions",)),
    "G11": QuerySpec(("pagePath",), ("userEngagementDuration",)),
    "G12": QuerySpec(("pagePath",), ("eventCount",), event_filter="scroll"),
    "G13": QuerySpec(("landingPage", CHANNEL_DIMENSION), ("sessions",)),
    "G14": QuerySpec(
        ("landingPage", "sessionSource"), ("sessions",), channel_filter="Organic Social"
    ),
    "G15": QuerySpec(("landingPage", "deviceCategory"), ("sessions",)),
    "G16": QuerySpec(("sessionSource",), ("sessions",), channel_filter="Referral"),
    "G17": QuerySpec(("sessionSource",), ("sessions",), channel_filter="Referral"),
    "G19": QuerySpec((CHANNEL_DIMENSION,), ("sessions",)),
    "G20": QuerySpec(("deviceCategory",), ("screenPageViews", "sessions")),
}


@dataclass(frozen=True, slots=True)
class NamedRange:
    name: str
    start: date
    end: date


@dataclass(frozen=True, slots=True)
class Row:
    range_name: str
    dimensions: dict[str, str]
    metrics: dict[str, str]

    def metric_int(self, name: str) -> int:
        """指標は文字列で返る。秒などは小数のことがあるので切り捨てる。"""
        return int(float(self.metrics[name]))


@dataclass(slots=True)
class Usage:
    requests: int = 0
    tokens: int = 0
    remaining_day: int | None = None
    remaining_hour: int | None = None
    unknown_device_rows: int = 0
    extra: dict[str, int] = field(default_factory=dict)


def _exact(field_name: str, value: str) -> FilterExpression:
    return FilterExpression(
        filter=Filter(field_name=field_name, string_filter=Filter.StringFilter(value=value))
    )


def _build_filter(spec: QuerySpec, landing_paths: Sequence[str] | None) -> FilterExpression | None:
    filters: list[FilterExpression] = []
    if spec.channel_filter is not None:
        filters.append(_exact(CHANNEL_DIMENSION, spec.channel_filter))
    if spec.event_filter is not None:
        filters.append(_exact("eventName", spec.event_filter))
    if landing_paths is not None:
        filters.append(
            FilterExpression(
                filter=Filter(
                    field_name="landingPage",
                    in_list_filter=Filter.InListFilter(values=list(landing_paths)),
                )
            )
        )
    if not filters:
        return None
    if len(filters) == 1:
        return filters[0]
    return FilterExpression(and_group=FilterExpressionList(expressions=filters))


def build_request(
    query_id: str,
    property_name: str,
    ranges: Sequence[NamedRange],
    *,
    landing_paths: Sequence[str] | None = None,
    offset: int = 0,
) -> RunReportRequest:
    spec = GA4_QUERIES[query_id]
    request = RunReportRequest(
        property=property_name,
        dimensions=[Dimension(name=name) for name in spec.dimensions],
        metrics=[Metric(name=name) for name in spec.metrics],
        date_ranges=[
            DateRange(
                name=item.name,
                start_date=item.start.isoformat(),
                end_date=item.end.isoformat(),
            )
            for item in ranges
        ],
        limit=GA4_ROW_LIMIT,
        offset=offset,
        return_property_quota=True,
    )
    expression = _build_filter(spec, landing_paths)
    if expression is not None:
        request.dimension_filter = expression
    return request


def parse_rows(response: RunReportResponse, ranges: Sequence[NamedRange]) -> list[Row]:
    """dateRange の列は日付の範囲が複数のときだけ付く。見出しの名前で位置を決める。"""
    dimension_names = [header.name for header in response.dimension_headers]
    metric_names = [header.name for header in response.metric_headers]
    default_range = ranges[0].name
    rows: list[Row] = []
    for row in response.rows:
        dimensions = {
            name: value.value
            for name, value in zip(dimension_names, row.dimension_values, strict=True)
        }
        range_name = dimensions.pop(_DATE_RANGE_DIMENSION, default_range)
        metrics = {
            name: value.value for name, value in zip(metric_names, row.metric_values, strict=True)
        }
        rows.append(Row(range_name, dimensions, metrics))
    return rows


class Ga4Client:
    def __init__(
        self,
        api: Ga4Api,
        property_id: SecretStr,
        sleep: Callable[[float], None],
        *,
        stop_low_quota: bool,
    ) -> None:
        self._api = api
        self._property_name = f"properties/{property_id.get_secret_value()}"
        self._sleep = sleep
        self._stop_low_quota = stop_low_quota
        self._has_requested = False
        self.usage = Usage()

    def _send(self, request: RunReportRequest) -> RunReportResponse:
        """429 は 60 秒待って 1 回、5xx は短く待って 1 回だけ再試行する（03 §5、§11）。"""
        try:
            return self._call(request)
        except google_api.ResourceExhausted:
            self._sleep(GA4_QUOTA_RETRY_WAIT_SECONDS)
        except (google_api.ServerError, google_api.DeadlineExceeded):
            self._sleep(GA4_SERVER_ERROR_RETRY_WAIT_SECONDS)
        return self._call(request)

    def _call(self, request: RunReportRequest) -> RunReportResponse:
        if self._has_requested:
            self._sleep(GA4_REQUEST_INTERVAL_MS / 1000)
        self._has_requested = True
        self.usage.requests += 1
        return self._api.run_report(request, timeout=GA4_REQUEST_TIMEOUT_SECONDS)

    def _record_quota(self, response: RunReportResponse) -> None:
        # 割当が返らなかった応答は記録しない（残量 0 と読み違えて止めない）
        if "property_quota" not in response:
            return
        quota = response.property_quota
        self.usage.tokens += quota.tokens_per_day.consumed
        self.usage.remaining_day = quota.tokens_per_day.remaining
        # counts のキーは 1 時間で 1 つだけなので、厳しいほうの残量を残す
        self.usage.remaining_hour = min(
            quota.tokens_per_hour.remaining, quota.tokens_per_project_per_hour.remaining
        )
        if (
            self._stop_low_quota
            and quota.tokens_per_project_per_hour.remaining < GA4_MIN_PROJECT_HOUR_TOKENS
        ):
            raise BatchQuotaError

    def report(
        self,
        query_id: str,
        ranges: Sequence[NamedRange],
        *,
        landing_paths: Sequence[str] | None = None,
    ) -> list[Row]:
        """全行を返す。行数が limit を超えれば offset でページングする。"""
        rows: list[Row] = []
        offset = 0
        while True:
            request = build_request(
                query_id,
                self._property_name,
                ranges,
                landing_paths=landing_paths,
                offset=offset,
            )
            response = self._send(request)
            self._record_quota(response)
            page = parse_rows(response, ranges)
            rows.extend(page)
            offset += len(page)
            if not page or offset >= response.row_count:
                return rows
