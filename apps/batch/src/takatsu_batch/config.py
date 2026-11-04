"""公開してよい設定値（03 §16、NFR-22 (1)）。変更はコミットで記録する。

秘密情報はここに置かない。環境変数の検証は env.py（構築 2）で行う。
"""

from typing import Final, Literal, get_args

type SslMode = Literal["verify-full", "verify-ca"]
type ChannelBucket = Literal["search", "social", "direct", "referral", "other"]
type SnsBucket = Literal["instagram", "facebook", "x", "line", "other"]
type DeviceBucket = Literal["mobile", "desktop", "tablet"]
type NewReturningBucket = Literal["new", "returning", "unknown"]
type LocalBucket = Literal["kawasaki", "japan_other", "unknown"]

MASK_THRESHOLD: Final = 5
RECENT_HOT_MIN_PV_7D: Final = 20
# 次の 4 つは「基準日 − 公開日」と比べる（M-21、M-22、M-23）。
# age_days（基準日 − 公開日 + 1）と比べない。
RECENT_HOT_MIN_DAYS_SINCE_PUBLISH: Final = 15
NEW_MAX_DAYS_SINCE_PUBLISH: Final = 30
LONG_MIN_DAYS_SINCE_PUBLISH: Final = 91
EVERGREEN_MIN_DAYS_SINCE_PUBLISH: Final = 365
# internal.benchmark_curve の SQL にも現れる（07 I-DB-17 で一致を確かめる）
BENCHMARK_MIN_POPULATION: Final = 30
OWN_MEDIAN_MIN_POSTS: Final = 5
MILESTONES: Final[tuple[int, ...]] = (500, 1000, 5000, 10000)
BACKFILL_START: Final = "2025-10-08"
REFETCH_DAYS: Final = 7
CONFIRM_DELAY_DAYS: Final = 7
AD_CATEGORY_ID: Final = 188
TOP_N_REFERRER_SITE: Final = 10
TOP_N_CITY: Final = 10
TOP_N_REFERRER_ARTICLE: Final = 3
SITE_ORIGIN: Final = "https://takatsu-connect.com"
WP_REQUEST_INTERVAL_MS: Final = 1000

# DB 接続の TLS（ADR 0009 の基準 第 1）。require は型の上で持てない。
DB_SSLMODE: Final[SslMode] = "verify-full"

# バケットの固定順。二次伏せの同値の判定もこの順を使う（03 §6.1 手順 3）。
CHANNEL_BUCKETS: Final[tuple[ChannelBucket, ...]] = get_args(ChannelBucket.__value__)
SNS_BUCKETS: Final[tuple[SnsBucket, ...]] = get_args(SnsBucket.__value__)
DEVICE_BUCKETS: Final[tuple[DeviceBucket, ...]] = get_args(DeviceBucket.__value__)
NEW_RETURNING_BUCKETS: Final[tuple[NewReturningBucket, ...]] = get_args(
    NewReturningBucket.__value__
)
LOCAL_BUCKETS: Final[tuple[LocalBucket, ...]] = get_args(LocalBucket.__value__)
# 曜日（0 = 日曜）× 時間帯の 168 セル。1 つの排他的区分として扱う（03 §6.1 手順 4）。
HEATMAP_BUCKETS: Final[tuple[tuple[int, int], ...]] = tuple(
    (dow, hour) for dow in range(7) for hour in range(24)
)
