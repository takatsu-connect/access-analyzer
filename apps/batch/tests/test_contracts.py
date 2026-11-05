"""S-16: 言語をまたぐ定数が contracts/constants.json と一致する（ADR 0004、FR-04）。

JSON を正とする。実行時には読まず、Python と TypeScript のテストがそれぞれ自分の定数と突き合わせる。
"""

import json
from pathlib import Path

from takatsu_batch import config

CONTRACT = Path(__file__).resolve().parents[3] / "contracts" / "constants.json"


def _contract() -> dict[str, object]:
    loaded: dict[str, object] = json.loads(CONTRACT.read_text(encoding="utf-8"))
    return loaded


def test_python_constants_match_contract() -> None:
    assert _contract() == {
        "SITE_ORIGIN": config.SITE_ORIGIN,
        # 読まれた回数を数え始めた日。バッチでは BACKFILL_START、BI では MEASURE_START
        "MEASURE_START": config.BACKFILL_START,
        "AD_CATEGORY_ID": config.AD_CATEGORY_ID,
        "CHANNEL_BUCKETS": list(config.CHANNEL_BUCKETS),
        "SNS_BUCKETS": list(config.SNS_BUCKETS),
        "DEVICE_BUCKETS": list(config.DEVICE_BUCKETS),
        "NEW_RETURNING_BUCKETS": list(config.NEW_RETURNING_BUCKETS),
        "LOCAL_BUCKETS": list(config.LOCAL_BUCKETS),
        "FRESHNESS_BUCKETS": list(config.FRESHNESS_BUCKETS),
        "SITE_AXES": list(config.SITE_AXES),
        "ARTICLE_AXES": list(config.ARTICLE_AXES),
        "AUTHOR_AXES": list(config.AUTHOR_AXES),
        "WINDOW_PERIOD_IDS": list(config.WINDOW_IDS),
    }


def test_contract_holds_no_secret_like_values() -> None:
    # 公開してよい設定だけを置く。URL は対象サイトの origin だけ
    text = CONTRACT.read_text(encoding="utf-8")
    assert text.count("https://") == 1
    assert "supabase" not in text.lower()
