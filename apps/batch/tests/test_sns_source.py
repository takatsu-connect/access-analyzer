"""U-02: SNS 参照元の正規化（03 §5.2）。U-03: 流入チャネル（M-10）。"""

import pytest

from takatsu_batch.channel import map_channel
from takatsu_batch.config import CHANNEL_BUCKETS
from takatsu_batch.sns_source import normalize_sns_source, to_sns_bucket


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        ("l.instagram.com", "instagram"),
        ("instagram.com", "instagram"),
        ("ig", "instagram"),
        ("instagram", "instagram"),
        ("www.instagram.com", "instagram"),
        ("facebook.com", "facebook"),
        ("lm.facebook.com", "facebook"),
        ("l.facebook.com", "facebook"),
        ("m.facebook.com", "facebook"),
        ("facebook", "facebook"),
        ("fb", "facebook"),
        ("web.facebook.com", "facebook"),
        ("t.co", "x"),
        ("twitter.com", "x"),
        ("x.com", "x"),
        ("twitter", "x"),
        ("mobile.twitter.com", "x"),
        ("mobile.x.com", "x"),
        ("line.me", "line"),
        ("lin.ee", "line"),
        ("line", "line"),
        ("timeline.line.me", "line"),
        ("liff.line.me", "line"),
        ("threads", "other"),
        ("threads.net", "other"),
        ("L.INSTAGRAM.COM", "instagram"),
        ("  T.CO ", "x"),
    ],
)
def test_mapped(source: str, expected: str) -> None:
    assert normalize_sns_source(source) == expected


@pytest.mark.parametrize(
    "source",
    [
        "youtube.com",
        "",
        "(not set)",
        # 後方一致は `.` の境界でだけ効く
        "netflix.com",
        "notinstagram.com",
        "myfacebook.com",
        "online.me",
        "instagram.com.example.org",
    ],
)
def test_unmapped(source: str) -> None:
    result = normalize_sns_source(source)
    assert result == "unmapped"
    assert to_sns_bucket(result) == "other"


def test_bucket_keeps_mapped_value() -> None:
    assert to_sns_bucket("line") == "line"
    assert to_sns_bucket("other") == "other"


@pytest.mark.parametrize(
    ("group", "expected"),
    [
        ("Organic Search", "search"),
        ("Organic Social", "social"),
        ("Direct", "direct"),
        ("Referral", "referral"),
        ("AI Assistant", "other"),
        ("Email", "other"),
        ("Organic Video", "other"),
        ("Unassigned", "other"),
        ("Paid Search", "other"),
        ("Paid Social", "other"),
        ("Paid Other", "other"),
        ("Paid Shopping", "other"),
        ("Paid Video", "other"),
        ("Cross-network", "other"),
        ("Display", "other"),
        ("Affiliates", "other"),
        ("Audio", "other"),
        ("SMS", "other"),
        ("Mobile Push Notifications", "other"),
        ("", "other"),
    ],
)
def test_channel(group: str, expected: str) -> None:
    result = map_channel(group)
    assert result == expected
    assert result in CHANNEL_BUCKETS
