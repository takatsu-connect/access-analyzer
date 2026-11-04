"""設定値（03 §16）。値を変えるときは根拠の要件も見直すので、ここで固定する。"""

from typing import get_args

from takatsu_batch import config


def test_values_match_design_table() -> None:
    assert config.MASK_THRESHOLD == 5
    assert config.RECENT_HOT_MIN_PV_7D == 20
    assert config.RECENT_HOT_MIN_AGE_DAYS == 15
    assert config.LONG_AGE_DAYS == 91
    assert config.BENCHMARK_MIN_POPULATION == 30
    assert config.OWN_MEDIAN_MIN_POSTS == 5
    assert config.MILESTONES == (500, 1000, 5000, 10000)
    assert config.BACKFILL_START == "2025-10-08"
    assert config.REFETCH_DAYS == 7
    assert config.CONFIRM_DELAY_DAYS == 7
    assert config.AD_CATEGORY_ID == 188
    assert config.TOP_N_REFERRER_SITE == 10
    assert config.TOP_N_CITY == 10
    assert config.TOP_N_REFERRER_ARTICLE == 3
    assert config.SITE_ORIGIN == "https://takatsu-connect.com"
    assert config.WP_REQUEST_INTERVAL_MS == 1000


def test_mask_zero_setting_does_not_exist() -> None:
    # D-16: 0 を伏せる切り替えを持たない
    assert not hasattr(config, "MASK_ZERO")


def test_sslmode_cannot_be_require() -> None:
    assert config.DB_SSLMODE == "verify-full"
    assert "require" not in get_args(config.SslMode.__value__)


def test_buckets() -> None:
    assert config.CHANNEL_BUCKETS == ("search", "social", "direct", "referral", "other")
    assert config.SNS_BUCKETS == ("instagram", "facebook", "x", "line", "other")
    assert config.DEVICE_BUCKETS == ("mobile", "desktop", "tablet")
    assert config.NEW_RETURNING_BUCKETS == ("new", "returning", "unknown")
    assert config.LOCAL_BUCKETS == ("kawasaki", "japan_other", "unknown")
    assert len(config.HEATMAP_BUCKETS) == 168
    assert len(set(config.HEATMAP_BUCKETS)) == 168
