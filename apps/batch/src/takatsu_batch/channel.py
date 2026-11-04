"""GA4 の sessionDefaultChannelGroup から流入チャネル 5 区分への正規化（03 §5.2、M-10）。"""

from typing import Final

from takatsu_batch.config import ChannelBucket

_CHANNEL_MAP: Final[dict[str, ChannelBucket]] = {
    "Organic Search": "search",
    "Organic Social": "social",
    "Direct": "direct",
    "Referral": "referral",
}


def map_channel(group: str) -> ChannelBucket:
    """上の 4 つ以外（AI Assistant、Email、Unassigned、Paid 系など）はすべて `other`。"""
    return _CHANNEL_MAP.get(group, "other")
