"""U-22: GA4 のリクエストの組み立て（03 §5、§5.4）と、Ga4Client の実行の規則（03 §5、§10）。

U-22 のほかに、parse_rows、リクエストの間隔、429 と 5xx の再試行、割当の記録、ページングを確かめる。
"""

from datetime import date

import google.api_core.exceptions as google_api
import pytest
from google.analytics.data_v1beta.types import (
    DateRange,
    Dimension,
    DimensionHeader,
    DimensionValue,
    Filter,
    FilterExpression,
    Metric,
    MetricHeader,
    MetricValue,
    RunReportRequest,
    RunReportResponse,
)
from google.analytics.data_v1beta.types import Row as ApiRow
from pydantic import SecretStr

from support.fake_ga4 import (
    FakeGa4,
    FakeResponses,
    Signature,
    identify_query,
    landing_paths_of,
    request_signature,
    spec_signature,
)
from takatsu_batch.errors import BatchQuotaError
from takatsu_batch.ga4_client import (
    GA4_QUERIES,
    Ga4Client,
    NamedRange,
    Row,
    build_request,
    parse_rows,
)

PROPERTY_ID = "123456789"
PROPERTY = f"properties/{PROPERTY_ID}"
CHANNEL = "sessionDefaultChannelGroup"
INTERVAL_SECONDS = 0.2

# U-22 の禁止名（廃止した指標と、公開しない次元）
FORBIDDEN_NAMES = frozenset(
    {
        "newUsers",
        "totalUsers",
        "engagedSessions",
        "engagementRate",
        "averageSessionDuration",
        "bounceRate",
        "pageReferrer",
        "pageLocation",
    }
)
FORBIDDEN_PREFIX = "customEvent:"

# 03 §5.4 の表を手で写したもの: (次元, 指標, チャネルのフィルタ, イベントのフィルタ)
EXPECTED_QUERIES: dict[str, Signature] = {
    "G1": (("date",), ("screenPageViews", "sessions"), None, None),
    "G2": (("date", CHANNEL), ("sessions",), None, None),
    "G3": (("date", "deviceCategory"), ("screenPageViews", "sessions"), None, None),
    "G4": (("date", "pagePath"), ("screenPageViews",), None, None),
    "G5": ((), ("activeUsers", "userEngagementDuration"), None, None),
    "G6": (("newVsReturning",), ("activeUsers",), None, None),
    "G7": (("sessionSource",), ("sessions",), "Organic Social", None),
    "G8": (("dayOfWeek", "hour"), ("screenPageViews",), None, None),
    "G9": (("country", "region", "city"), ("sessions",), None, None),
    "G10": (("landingPage",), ("sessions",), None, None),
    "G11": (("pagePath",), ("userEngagementDuration",), None, None),
    "G12": (("pagePath",), ("eventCount",), None, "scroll"),
    "G13": (("landingPage", CHANNEL), ("sessions",), None, None),
    "G14": (("landingPage", "sessionSource"), ("sessions",), "Organic Social", None),
    "G15": (("landingPage", "deviceCategory"), ("sessions",), None, None),
    "G16": (("sessionSource",), ("sessions",), "Referral", None),
    "G17": (("sessionSource",), ("sessions",), "Referral", None),
    "G19": ((CHANNEL,), ("sessions",), None, None),
    "G20": (("deviceCategory",), ("screenPageViews", "sessions"), None, None),
}
QUERY_IDS = sorted(EXPECTED_QUERIES)

# 期間集合の例。月末と年末をまたぐ月を含める
PERIOD_SET = [
    NamedRange("last7", date(2026, 10, 29), date(2026, 11, 4)),
    NamedRange("prev7", date(2026, 10, 22), date(2026, 10, 28)),
    NamedRange("m2025-12", date(2025, 12, 1), date(2025, 12, 31)),
    NamedRange("m2026-02", date(2026, 2, 1), date(2026, 2, 28)),
]
DAILY = [NamedRange("daily", date(2026, 10, 29), date(2026, 11, 4))]


# --- U-22: リクエストの組み立て ---


def test_query_kinds_are_the_19_of_the_design() -> None:
    assert sorted(GA4_QUERIES) == QUERY_IDS
    assert len(GA4_QUERIES) == 19
    # シェア数（G18）は初回対象外
    assert "G18" not in GA4_QUERIES


@pytest.mark.parametrize("query_id", QUERY_IDS)
def test_request_has_no_forbidden_dimension_or_metric(query_id: str) -> None:
    request = build_request(query_id, PROPERTY, PERIOD_SET)
    names = [item.name for item in request.dimensions] + [item.name for item in request.metrics]
    assert FORBIDDEN_NAMES.isdisjoint(names)
    assert not [name for name in names if name.startswith(FORBIDDEN_PREFIX)]


@pytest.mark.parametrize("query_id", QUERY_IDS)
def test_request_matches_the_design_table(query_id: str) -> None:
    assert spec_signature(GA4_QUERIES[query_id]) == EXPECTED_QUERIES[query_id]
    request = build_request(query_id, PROPERTY, PERIOD_SET)
    assert request_signature(request) == EXPECTED_QUERIES[query_id]


@pytest.mark.parametrize("query_id", QUERY_IDS)
def test_request_common_fields(query_id: str) -> None:
    request = build_request(query_id, PROPERTY, PERIOD_SET)
    assert request.property == PROPERTY
    assert request.return_property_quota is True
    assert request.limit == 100_000
    assert request.offset == 0
    assert [(item.name, item.start_date, item.end_date) for item in request.date_ranges] == [
        ("last7", "2026-10-29", "2026-11-04"),
        ("prev7", "2026-10-22", "2026-10-28"),
        ("m2025-12", "2025-12-01", "2025-12-31"),
        ("m2026-02", "2026-02-01", "2026-02-28"),
    ]


def test_event_filter_is_only_scroll_on_g12() -> None:
    # AddToAnyShare は初回対象外（M-4）
    event_filters = {
        query_id: request_signature(build_request(query_id, PROPERTY, PERIOD_SET))[3]
        for query_id in GA4_QUERIES
    }
    assert {key: value for key, value in event_filters.items() if value is not None} == {
        "G12": "scroll"
    }


def test_geo_dimensions_stop_at_city() -> None:
    request = build_request("G9", PROPERTY, PERIOD_SET)
    assert [item.name for item in request.dimensions] == ["country", "region", "city"]
    # 03 §5.4 に現れる次元と指標だけを使う。市区より細かい地域の次元はない
    allowed_dimensions = {name for spec in EXPECTED_QUERIES.values() for name in spec[0]}
    allowed_metrics = {name for spec in EXPECTED_QUERIES.values() for name in spec[1]}
    assert {name for spec in GA4_QUERIES.values() for name in spec.dimensions} <= allowed_dimensions
    assert {name for spec in GA4_QUERIES.values() for name in spec.metrics} <= allowed_metrics


def test_g19_and_g20_use_the_period_set() -> None:
    g19 = build_request("G19", PROPERTY, PERIOD_SET)
    assert [item.name for item in g19.dimensions] == [CHANNEL]
    assert [item.name for item in g19.metrics] == ["sessions"]
    g20 = build_request("G20", PROPERTY, PERIOD_SET)
    assert [item.name for item in g20.dimensions] == ["deviceCategory"]
    assert [item.name for item in g20.metrics] == ["screenPageViews", "sessions"]
    for request in (g19, g20):
        assert [item.name for item in request.date_ranges] == [item.name for item in PERIOD_SET]
        assert "dimension_filter" not in request


@pytest.mark.parametrize(
    ("query_id", "channel"),
    [
        ("G7", "Organic Social"),
        ("G14", "Organic Social"),
        ("G16", "Referral"),
        ("G17", "Referral"),
    ],
)
def test_channel_filter_is_an_exact_match(query_id: str, channel: str) -> None:
    request = build_request(query_id, PROPERTY, PERIOD_SET)
    item = request.dimension_filter.filter
    assert item.field_name == CHANNEL
    assert item.string_filter.value == channel
    # 未指定は GA4 の側で完全一致として扱われる
    assert item.string_filter.match_type in (
        Filter.StringFilter.MatchType.MATCH_TYPE_UNSPECIFIED,
        Filter.StringFilter.MatchType.EXACT,
    )


def test_queries_without_filter_send_no_filter() -> None:
    without_filter = [
        query_id
        for query_id in GA4_QUERIES
        if "dimension_filter" not in build_request(query_id, PROPERTY, PERIOD_SET)
    ]
    assert sorted(without_filter) == sorted(
        query_id
        for query_id, spec in EXPECTED_QUERIES.items()
        if spec[2] is None and spec[3] is None
    )


def test_g17_adds_landing_paths_as_in_list_filter() -> None:
    window = [NamedRange("article", date(2026, 9, 1), date(2026, 9, 30))]
    request = build_request("G17", PROPERTY, window, landing_paths=["/101/", "/101"])
    expressions = list(request.dimension_filter.and_group.expressions)
    assert len(expressions) == 2
    by_field = {item.filter.field_name: item.filter for item in expressions}
    assert by_field[CHANNEL].string_filter.value == "Referral"
    assert list(by_field["landingPage"].in_list_filter.values) == ["/101/", "/101"]
    # 偽の GA4 の署名は landingPage のフィルタを無視し、G16 と G17 はフィルタの有無で見分ける
    assert request_signature(request) == EXPECTED_QUERIES["G17"]
    assert landing_paths_of(request) == ("/101/", "/101")
    assert identify_query(request) == "G17"
    assert identify_query(build_request("G16", PROPERTY, window)) == "G16"


def test_offset_is_passed_to_the_request() -> None:
    assert build_request("G4", PROPERTY, DAILY, offset=100_000).offset == 100_000


# --- parse_rows ---


def _response(
    dimension_names: list[str], metric_names: list[str], rows: list[tuple[list[str], list[str]]]
) -> RunReportResponse:
    return RunReportResponse(
        dimension_headers=[DimensionHeader(name=name) for name in dimension_names],
        metric_headers=[MetricHeader(name=name) for name in metric_names],
        rows=[
            ApiRow(
                dimension_values=[DimensionValue(value=value) for value in dimensions],
                metric_values=[MetricValue(value=value) for value in metrics],
            )
            for dimensions, metrics in rows
        ],
        row_count=len(rows),
    )


@pytest.mark.parametrize(
    ("dimension_names", "values"),
    [
        (["pagePath", "dateRange"], ["/101/", "prev7"]),
        # 位置ではなく見出しの名前で決める
        (["dateRange", "pagePath"], ["prev7", "/101/"]),
    ],
)
def test_parse_rows_moves_date_range_column_to_range_name(
    dimension_names: list[str], values: list[str]
) -> None:
    response = _response(dimension_names, ["screenPageViews"], [(values, ["3"])])
    assert parse_rows(response, PERIOD_SET) == [
        Row("prev7", {"pagePath": "/101/"}, {"screenPageViews": "3"})
    ]


def test_parse_rows_uses_the_first_range_when_there_is_no_date_range_column() -> None:
    response = _response(
        ["date"],
        ["screenPageViews", "sessions"],
        [(["20261104"], ["12", "5"]), (["20261103"], ["0", "0"])],
    )
    assert parse_rows(response, DAILY) == [
        Row("daily", {"date": "20261104"}, {"screenPageViews": "12", "sessions": "5"}),
        Row("daily", {"date": "20261103"}, {"screenPageViews": "0", "sessions": "0"}),
    ]


def test_parse_rows_without_dimensions_and_without_rows() -> None:
    # G5 は次元なし
    response = _response([], ["activeUsers"], [([], ["42"])])
    assert parse_rows(response, DAILY) == [Row("daily", {}, {"activeUsers": "42"})]
    assert parse_rows(_response(["date"], ["sessions"], []), DAILY) == []


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("7", 7), ("0", 0), ("0.0", 0), ("1234.9", 1234), ("59.999999", 59)],
)
def test_metric_int_truncates_fraction(raw: str, expected: int) -> None:
    assert (
        Row("daily", {}, {"userEngagementDuration": raw}).metric_int("userEngagementDuration")
        == expected
    )


# --- Ga4Client ---

G1_RESPONSES: FakeResponses = {
    "G1": {"daily": [({"date": "20261104"}, {"screenPageViews": "10", "sessions": "4"})]}
}
G1_ROWS = [Row("daily", {"date": "20261104"}, {"screenPageViews": "10", "sessions": "4"})]


def _client(fake: FakeGa4, sleeps: list[float], *, stop_low_quota: bool = False) -> Ga4Client:
    return Ga4Client(fake, SecretStr(PROPERTY_ID), sleeps.append, stop_low_quota=stop_low_quota)


def _waits(sleeps: list[float]) -> list[float]:
    """リクエスト間の 200 ms を除いた、再試行の前の待ち。"""
    return [seconds for seconds in sleeps if seconds != INTERVAL_SECONDS]


def _api_error(error_type: type[google_api.GoogleAPICallError]) -> google_api.GoogleAPICallError:
    """google の例外は型注釈のないコンストラクタなので、型を経由して作る。"""
    return error_type("fake")


def test_client_sends_property_name_and_timeout() -> None:
    fake = FakeGa4(G1_RESPONSES)
    sleeps: list[float] = []
    assert _client(fake, sleeps).report("G1", DAILY) == G1_ROWS
    assert [request.property for request in fake.requests] == [PROPERTY]
    assert fake.timeouts == [120.0]


def test_client_waits_200ms_between_requests_but_not_before_the_first() -> None:
    fake = FakeGa4(G1_RESPONSES)
    sleeps: list[float] = []
    client = _client(fake, sleeps)
    client.report("G1", DAILY)
    assert sleeps == []
    client.report("G1", DAILY)
    client.report("G2", DAILY)
    assert sleeps == [INTERVAL_SECONDS, INTERVAL_SECONDS]


def test_client_retries_once_after_60_seconds_on_429() -> None:
    fake = FakeGa4(G1_RESPONSES, side_effects={"G1": [_api_error(google_api.ResourceExhausted)]})
    sleeps: list[float] = []
    client = _client(fake, sleeps)
    assert client.report("G1", DAILY) == G1_ROWS
    assert _waits(sleeps) == [60]
    assert client.usage.requests == 2
    assert len(fake.requests) == 2


def test_client_gives_up_on_the_second_429() -> None:
    fake = FakeGa4(
        G1_RESPONSES,
        side_effects={
            "G1": [
                _api_error(google_api.ResourceExhausted),
                _api_error(google_api.ResourceExhausted),
            ]
        },
    )
    sleeps: list[float] = []
    client = _client(fake, sleeps)
    with pytest.raises(google_api.ResourceExhausted):
        client.report("G1", DAILY)
    assert _waits(sleeps) == [60]
    assert client.usage.requests == 2
    assert len(fake.requests) == 2


@pytest.mark.parametrize(
    "error_type",
    [google_api.ServiceUnavailable, google_api.DeadlineExceeded, google_api.InternalServerError],
)
def test_client_retries_once_after_2_seconds_on_server_error(
    error_type: type[google_api.GoogleAPICallError],
) -> None:
    fake = FakeGa4(G1_RESPONSES, side_effects={"G1": [_api_error(error_type)]})
    sleeps: list[float] = []
    client = _client(fake, sleeps)
    assert client.report("G1", DAILY) == G1_ROWS
    assert _waits(sleeps) == [2]
    assert client.usage.requests == 2

    # 2 回続けば送出する
    fake = FakeGa4(
        G1_RESPONSES, side_effects={"G1": [_api_error(error_type), _api_error(error_type)]}
    )
    sleeps = []
    client = _client(fake, sleeps)
    with pytest.raises(error_type):
        client.report("G1", DAILY)
    assert _waits(sleeps) == [2]
    assert client.usage.requests == 2


def test_client_does_not_retry_permission_denied() -> None:
    fake = FakeGa4(G1_RESPONSES, side_effects={"G1": [_api_error(google_api.PermissionDenied)]})
    sleeps: list[float] = []
    client = _client(fake, sleeps)
    with pytest.raises(google_api.PermissionDenied):
        client.report("G1", DAILY)
    assert sleeps == []
    assert client.usage.requests == 1
    assert len(fake.requests) == 1


@pytest.mark.parametrize(
    ("remaining_hour", "remaining_project_hour", "expected_hour"),
    [
        (39_990, 13_990, 13_990),
        (500, 13_990, 500),
        (7_000, 7_000, 7_000),
    ],
)
def test_client_records_usage(
    remaining_hour: int, remaining_project_hour: int, expected_hour: int
) -> None:
    fake = FakeGa4(
        G1_RESPONSES,
        consumed=7,
        remaining_day=199_000,
        remaining_hour=remaining_hour,
        remaining_project_hour=remaining_project_hour,
    )
    client = _client(fake, [])
    # 1 回も問い合わせていないときは残量が分からない
    assert (client.usage.requests, client.usage.tokens) == (0, 0)
    assert client.usage.remaining_day is None
    assert client.usage.remaining_hour is None
    client.report("G1", DAILY)
    client.report("G2", DAILY)
    client.report("G3", DAILY)
    assert client.usage.requests == 3
    assert client.usage.tokens == 21
    assert client.usage.remaining_day == 199_000
    assert client.usage.remaining_hour == expected_hour


def test_client_keeps_the_latest_remaining_quota() -> None:
    fake = FakeGa4(G1_RESPONSES, remaining_day=1_000)
    client = _client(fake, [])
    client.report("G1", DAILY)
    fake.remaining_day = 990
    client.report("G1", DAILY)
    assert client.usage.remaining_day == 990


@pytest.mark.parametrize(
    ("stop_low_quota", "remaining_hour", "remaining_project_hour", "stops"),
    [
        (True, 39_990, 1_999, True),
        (True, 39_990, 0, True),
        # 2,000 ちょうどは止めない（下回ったら止める）
        (True, 39_990, 2_000, False),
        # 見るのはプロジェクト × プロパティの 1 時間の残量だけ
        (True, 100, 13_990, False),
        # daily は止めない
        (False, 39_990, 1_999, False),
        (False, 39_990, 0, False),
    ],
)
def test_client_stops_on_low_project_hour_quota_only_when_asked(
    stop_low_quota: bool, remaining_hour: int, remaining_project_hour: int, stops: bool
) -> None:
    fake = FakeGa4(
        G1_RESPONSES, remaining_hour=remaining_hour, remaining_project_hour=remaining_project_hour
    )
    client = _client(fake, [], stop_low_quota=stop_low_quota)
    if stops:
        with pytest.raises(BatchQuotaError):
            client.report("G1", DAILY)
    else:
        assert client.report("G1", DAILY) == G1_ROWS
    # 止めるときも、残量は記録してから止める
    assert client.usage.remaining_hour == min(remaining_hour, remaining_project_hour)


@pytest.mark.parametrize(
    ("total_rows", "expected_offsets"),
    [
        (0, [0]),
        (1, [0]),
        # 1 ページちょうどなら次を取りに行かない
        (2, [0]),
        (3, [0, 2]),
        (4, [0, 2]),
        (5, [0, 2, 4]),
    ],
)
def test_client_pages_with_offset_until_row_count(
    monkeypatch: pytest.MonkeyPatch, total_rows: int, expected_offsets: list[int]
) -> None:
    # 10 万行を作らずに済むよう、1 ページを 2 行にする
    monkeypatch.setattr("takatsu_batch.ga4_client.GA4_ROW_LIMIT", 2)
    fixture_rows = [
        ({"date": "20261104", "pagePath": f"/{101 + index}/"}, {"screenPageViews": str(index)})
        for index in range(total_rows)
    ]
    fake = FakeGa4({"G4": {"daily": fixture_rows}})
    client = _client(fake, [])
    rows = client.report("G4", DAILY)
    assert [row.dimensions["pagePath"] for row in rows] == [
        f"/{101 + index}/" for index in range(total_rows)
    ]
    assert [request.offset for request in fake.requests] == expected_offsets
    assert [request.limit for request in fake.requests] == [2] * len(expected_offsets)
    assert client.usage.requests == len(expected_offsets)
    assert client.usage.tokens == 10 * len(expected_offsets)


# --- 偽の GA4 の見張り（結合テストで「問い合わせは 19 種だけ」を保つため） ---


def _rogue_request(dimension: str, *, with_filter: bool = False) -> RunReportRequest:
    request = RunReportRequest(
        property=PROPERTY,
        dimensions=[Dimension(name=dimension)],
        metrics=[Metric(name="screenPageViews"), Metric(name="sessions")],
        date_ranges=[DateRange(name="daily", start_date="2026-10-29", end_date="2026-11-04")],
    )
    if with_filter:
        request.dimension_filter = FilterExpression(
            filter=Filter(field_name="pagePath", string_filter=Filter.StringFilter(value="/101/"))
        )
    return request


@pytest.mark.parametrize(
    "request_",
    [
        # 一覧にない次元
        _rogue_request("pageReferrer"),
        # 次元と指標は G1 と同じでも、一覧にないフィルタが付いている
        _rogue_request("date", with_filter=True),
    ],
)
def test_fake_rejects_requests_outside_the_query_list(request_: RunReportRequest) -> None:
    fake = FakeGa4(G1_RESPONSES)
    with pytest.raises(AssertionError):
        fake.run_report(request_, timeout=1.0)
    # 断られた request も記録に残る
    assert fake.requests == [request_]
    assert fake.query_ids == []


def test_fake_returns_quota_only_when_requested() -> None:
    request = _rogue_request("date")
    response = FakeGa4(G1_RESPONSES).run_report(request, timeout=1.0)
    assert response.row_count == 1
    assert "property_quota" not in response
    request.return_property_quota = True
    response = FakeGa4(G1_RESPONSES).run_report(request, timeout=1.0)
    assert response.property_quota.tokens_per_day.remaining == 199_990
    assert response.property_quota.tokens_per_hour.remaining == 39_990
    assert response.property_quota.tokens_per_project_per_hour.remaining == 13_990
    assert response.property_quota.tokens_per_day.consumed == 10


class _NoQuotaApi:
    """割当を返さない応答。"""

    def run_report(self, request: RunReportRequest, *, timeout: float) -> RunReportResponse:
        return RunReportResponse(row_count=0)


def test_response_without_quota_is_not_read_as_zero_remaining() -> None:
    # 割当が返らない応答を「残量 0」と読んで、バックフィルを 1 リクエスト目で止めない
    client = Ga4Client(
        _NoQuotaApi(), SecretStr("123456789"), lambda _seconds: None, stop_low_quota=True
    )
    ranges = [NamedRange("daily", date(2026, 11, 1), date(2026, 11, 1))]
    assert client.report("G1", ranges) == []
    assert client.usage.requests == 1
    assert client.usage.tokens == 0
    assert client.usage.remaining_day is None
    assert client.usage.remaining_hour is None
