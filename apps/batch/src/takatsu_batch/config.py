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
type FreshnessBucket = Literal["new", "mid", "long"]
type SiteAxis = Literal["sns", "new_returning", "local", "channel", "device_pv", "device_sessions"]
type ArticleAxis = Literal["channel", "sns", "device"]
type AuthorAxis = Literal["channel", "sns"]

MASK_THRESHOLD: Final = 5
RECENT_HOT_MIN_PV_7D: Final = 20
# 次の 4 つは「基準日 − 公開日」と比べる（M-21、M-22、M-23）。
# age_days（基準日 − 公開日 + 1）と比べない。
RECENT_HOT_MIN_DAYS_SINCE_PUBLISH: Final = 15
NEW_MAX_DAYS_SINCE_PUBLISH: Final = 30
LONG_MIN_DAYS_SINCE_PUBLISH: Final = 91
EVERGREEN_MIN_DAYS_SINCE_PUBLISH: Final = 365
# 分布のビュー（internal スキーマ）の SQL にも現れる（07 I-DB-17 で一致を確かめる）
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
WP_PER_PAGE: Final = 100
WP_MAX_RETRIES: Final = 3
WP_USER_AGENT: Final = (
    "takatsu-connect-access-analyzer/0.1 (+https://github.com/takatsu-connect/access-analyzer)"
)
# daily で一度に消してよい記事の上限。本数と、前回の記事数に対する割合の大きいほう（03 §4）
WP_DELETE_GUARD_MIN_POSTS: Final = 10
WP_DELETE_GUARD_PERCENT: Final = 5

# GA4 の前日ぶんの日次データが揃う時刻（JST の時、分。03 §2）
GA4_DATA_READY_JST: Final = (15, 30)
GA4_REQUEST_INTERVAL_MS: Final = 200
GA4_QUOTA_RETRY_WAIT_SECONDS: Final = 60
GA4_SERVER_ERROR_RETRY_WAIT_SECONDS: Final = 2
GA4_RANGES_PER_REQUEST: Final = 4
GA4_ROW_LIMIT: Final = 100_000
GA4_REQUEST_TIMEOUT_SECONDS: Final = 120.0
GA4_BACKFILL_CHUNK_DAYS: Final = 90
# バックフィルで 1 プロジェクト × プロパティ 1 時間の残量がこれを下回ったら止める（03 §10）
GA4_MIN_PROJECT_HOUR_TOKENS: Final = 2000

# DB 接続の TLS（ADR 0009 の基準 第 1）。require は型の上で持てない。
DB_SSLMODE: Final[SslMode] = "verify-full"
DB_CA_CERT_FILE: Final = "supabase-root-2021.crt"
DB_CONNECT_TIMEOUT_SECONDS: Final = 10
DB_WRITE_CHUNK_ROWS: Final = 1000
# これより長く running のままの行は、強制終了などで残ったものとして失敗に直す
ABANDONED_RUN_HOURS: Final = 2

# バケットの固定順。二次伏せの同値の判定もこの順を使う（03 §6.1 手順 3）。
CHANNEL_BUCKETS: Final[tuple[ChannelBucket, ...]] = get_args(ChannelBucket.__value__)
SNS_BUCKETS: Final[tuple[SnsBucket, ...]] = get_args(SnsBucket.__value__)
DEVICE_BUCKETS: Final[tuple[DeviceBucket, ...]] = get_args(DeviceBucket.__value__)
NEW_RETURNING_BUCKETS: Final[tuple[NewReturningBucket, ...]] = get_args(
    NewReturningBucket.__value__
)
LOCAL_BUCKETS: Final[tuple[LocalBucket, ...]] = get_args(LocalBucket.__value__)
FRESHNESS_BUCKETS: Final[tuple[FreshnessBucket, ...]] = get_args(FreshnessBucket.__value__)
SITE_AXES: Final[tuple[SiteAxis, ...]] = get_args(SiteAxis.__value__)
ARTICLE_AXES: Final[tuple[ArticleAxis, ...]] = get_args(ArticleAxis.__value__)
AUTHOR_AXES: Final[tuple[AuthorAxis, ...]] = get_args(AuthorAxis.__value__)
# 移動窓の固定 ID と日数（02 §2.2）
WINDOW_DAYS: Final[tuple[tuple[str, str, int], ...]] = (
    ("last7", "prev7", 7),
    ("last28", "prev28", 28),
    ("last90", "prev90", 90),
)
WINDOW_IDS: Final[tuple[str, ...]] = tuple(
    period_id for current, previous, _ in WINDOW_DAYS for period_id in (current, previous)
)
# 曜日（0 = 日曜）× 時間帯の 168 セル。1 つの排他的区分として扱う（03 §6.1 手順 4）。
HEATMAP_BUCKETS: Final[tuple[tuple[int, int], ...]] = tuple(
    (dow, hour) for dow in range(7) for hour in range(24)
)
