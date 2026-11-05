"""偽の GA4 Data API（07 のモックの方針）。単体テストと結合テスト（I-B）で使う。

`BetaAnalyticsDataClient.run_report` と同じ呼び出しの形を持ち、手で作った固定の行を
`RunReportResponse` に変換して返す。gRPC のサーバーは立てない。渡す値はすべて架空にする。

応答の引き方:

- request の次元・指標・フィルタから「署名」を作り、GA4_QUERIES のどの問い合わせかを決める。
  一覧にない問い合わせ、想定外のフィルタは AssertionError にする（問い合わせは 19 種に限る）。
- `responses[query_id][range 名]` の行を、request の date_ranges の順に並べて返す。
  行は `(次元の辞書, 指標の辞書)`。値は GA4 と同じく文字列で書く。
- date_ranges が 2 つ以上なら、GA4 と同じく `dateRange` の次元を末尾に足す（1 つなら足さない）。
- 次元に `date` がある問い合わせは、request の期間に入る行だけを返す（バックフィルの分割で
  同じ range 名が何度も来ても、行が重複しない）。
- landingPage の in_list フィルタ（G17）は、行の辞書の `landingPage` で絞り込む。
  `landingPage` は request の次元ではないので応答には出ない。記事のパスは `/101/` の形で書く。
- `limit` と `offset` に従ってページを切る。`row_count` は全行数。
- 同じ次元の値を持つ行の合算はしない。フィクスチャの側で次元の組を一意にする。
"""

from collections.abc import Mapping, Sequence
from typing import Final

from google.analytics.data_v1beta.types import (
    DimensionHeader,
    DimensionValue,
    FilterExpression,
    MetricHeader,
    MetricValue,
    PropertyQuota,
    QuotaStatus,
    Row,
    RunReportRequest,
    RunReportResponse,
)

from takatsu_batch.ga4_client import CHANNEL_DIMENSION, GA4_QUERIES, QuerySpec

# (次元の名前, 指標の名前, チャネルのフィルタ, イベントのフィルタ)
type Signature = tuple[tuple[str, ...], tuple[str, ...], str | None, str | None]
type FakeRow = tuple[Mapping[str, str], Mapping[str, str]]
# query_id → range 名 → 行
type FakeResponses = Mapping[str, Mapping[str, Sequence[FakeRow]]]

_EVENT_DIMENSION: Final = "eventName"
_LANDING_DIMENSION: Final = "landingPage"
_DATE_DIMENSION: Final = "date"
_DATE_RANGE_DIMENSION: Final = "dateRange"
# limit を指定しないときの GA4 の既定
_DEFAULT_LIMIT: Final = 10_000
# G16 と G17 は署名が同じ。landingPage のフィルタの有無で見分ける
_SAME_SIGNATURE: Final = frozenset({"G16", "G17"})


def spec_signature(spec: QuerySpec) -> Signature:
    """GA4_QUERIES の定義から署名を作る。"""
    return (spec.dimensions, spec.metrics, spec.channel_filter, spec.event_filter)


def _parse_filters(
    expression: FilterExpression,
) -> tuple[str | None, str | None, tuple[str, ...] | None]:
    """フィルタから (チャネル, イベント, landingPage の一覧) を拾う。ほかの形は認めない。"""
    channel: str | None = None
    event: str | None = None
    landing: tuple[str, ...] | None = None
    if "and_group" in expression:
        leaves = list(expression.and_group.expressions)
    elif "filter" in expression:
        leaves = [expression]
    elif "or_group" in expression or "not_expression" in expression:
        raise AssertionError("偽の GA4 が知らない形のフィルタ（or_group / not_expression）")
    else:
        leaves = []
    for leaf in leaves:
        if "filter" not in leaf:
            raise AssertionError("偽の GA4 が知らない形のフィルタ（入れ子）")
        item = leaf.filter
        if item.field_name == CHANNEL_DIMENSION and "string_filter" in item:
            channel = item.string_filter.value
        elif item.field_name == _EVENT_DIMENSION and "string_filter" in item:
            event = item.string_filter.value
        elif item.field_name == _LANDING_DIMENSION and "in_list_filter" in item:
            landing = tuple(item.in_list_filter.values)
        else:
            raise AssertionError("偽の GA4 が知らない次元へのフィルタ")
    return channel, event, landing


def request_signature(request: RunReportRequest) -> Signature:
    """request から署名を作る。landingPage の in_list フィルタは署名に含めない。"""
    channel, event, _ = _parse_filters(request.dimension_filter)
    return (
        tuple(item.name for item in request.dimensions),
        tuple(item.name for item in request.metrics),
        channel,
        event,
    )


def landing_paths_of(request: RunReportRequest) -> tuple[str, ...] | None:
    """landingPage の in_list フィルタの値。フィルタがなければ None。"""
    return _parse_filters(request.dimension_filter)[2]


def identify_query(request: RunReportRequest) -> str:
    """request が GA4_QUERIES のどれかを返す。一覧にないものは AssertionError。"""
    signature = request_signature(request)
    candidates = [
        query_id for query_id, spec in GA4_QUERIES.items() if spec_signature(spec) == signature
    ]
    if len(candidates) == 1:
        return candidates[0]
    if candidates and set(candidates) <= _SAME_SIGNATURE:
        return "G17" if landing_paths_of(request) is not None else "G16"
    raise AssertionError("GA4_QUERIES の一覧にない、または見分けられない問い合わせ")


class FakeGa4:
    """`takatsu_batch.ga4_client.Ga4Api` の偽物。

    - `requests` / `query_ids` / `timeouts`: 受け取った順の記録（例外を送出した回も含む）。
    - `side_effects[query_id]`: その問い合わせの呼び出しごとに先頭から 1 つ取り出し、
      例外なら送出する。None か、使い切ったあとは通常の応答を返す。
    - `consumed` などの割当の値は属性なので、途中で書き換えられる。
    """

    def __init__(
        self,
        responses: FakeResponses | None = None,
        *,
        side_effects: Mapping[str, Sequence[Exception | None]] | None = None,
        consumed: int = 10,
        remaining_day: int = 199_990,
        remaining_hour: int = 39_990,
        remaining_project_hour: int = 13_990,
    ) -> None:
        self._responses: FakeResponses = responses if responses is not None else {}
        self.side_effects: dict[str, list[Exception | None]] = {
            query_id: list(items) for query_id, items in (side_effects or {}).items()
        }
        self.consumed = consumed
        self.remaining_day = remaining_day
        self.remaining_hour = remaining_hour
        self.remaining_project_hour = remaining_project_hour
        self.requests: list[RunReportRequest] = []
        self.query_ids: list[str] = []
        self.timeouts: list[float] = []

    def run_report(self, request: RunReportRequest, *, timeout: float) -> RunReportResponse:
        self.requests.append(request)
        self.timeouts.append(timeout)
        query_id = identify_query(request)
        self.query_ids.append(query_id)
        pending = self.side_effects.get(query_id)
        if pending:
            error = pending.pop(0)
            if error is not None:
                raise error

        dimension_names = [item.name for item in request.dimensions]
        metric_names = [item.name for item in request.metrics]
        multiple_ranges = len(request.date_ranges) > 1
        rows = self._rows(query_id, request, dimension_names, metric_names)
        limit = request.limit or _DEFAULT_LIMIT
        headers = [*dimension_names, _DATE_RANGE_DIMENSION] if multiple_ranges else dimension_names
        response = RunReportResponse(
            dimension_headers=[DimensionHeader(name=name) for name in headers],
            metric_headers=[MetricHeader(name=name) for name in metric_names],
            rows=rows[request.offset : request.offset + limit],
            row_count=len(rows),
        )
        # 本物と同じく、求められたときだけ割当を返す
        if request.return_property_quota:
            response.property_quota = PropertyQuota(
                tokens_per_day=QuotaStatus(consumed=self.consumed, remaining=self.remaining_day),
                tokens_per_hour=QuotaStatus(consumed=self.consumed, remaining=self.remaining_hour),
                tokens_per_project_per_hour=QuotaStatus(
                    consumed=self.consumed, remaining=self.remaining_project_hour
                ),
            )
        return response

    def _rows(
        self,
        query_id: str,
        request: RunReportRequest,
        dimension_names: Sequence[str],
        metric_names: Sequence[str],
    ) -> list[Row]:
        by_range = self._responses.get(query_id, {})
        landing = landing_paths_of(request)
        multiple_ranges = len(request.date_ranges) > 1
        has_date = _DATE_DIMENSION in dimension_names
        rows: list[Row] = []
        for date_range in request.date_ranges:
            start = date_range.start_date.replace("-", "")
            end = date_range.end_date.replace("-", "")
            for dimensions, metrics in by_range.get(date_range.name, ()):
                if landing is not None and dimensions[_LANDING_DIMENSION] not in landing:
                    continue
                if has_date and not start <= dimensions[_DATE_DIMENSION] <= end:
                    continue
                values = [dimensions[name] for name in dimension_names]
                if multiple_ranges:
                    values.append(date_range.name)
                rows.append(
                    Row(
                        dimension_values=[DimensionValue(value=value) for value in values],
                        metric_values=[MetricValue(value=metrics[name]) for name in metric_names],
                    )
                )
        return rows
