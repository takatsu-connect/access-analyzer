"""pydantic モデルの共通の基底と、実行記録の件数（03 §15、02 §3.6、07 U-28）。"""

from pydantic import BaseModel, ConfigDict, Field


class BatchModel(BaseModel):
    """検証エラーに入力値を含めない（03 §15）。pydantic のモデルはすべてこれから作る。"""

    model_config = ConfigDict(hide_input_in_errors=True)


class RunCounts(BatchModel):
    """batch_run.counts。固定キー、0 以上の整数だけ。DB の check 制約と同じキー。"""

    model_config = ConfigDict(hide_input_in_errors=True, extra="forbid", strict=True, frozen=True)

    ga4_requests: int = Field(default=0, ge=0)
    ga4_tokens: int = Field(default=0, ge=0)
    ga4_tokens_remaining_day: int = Field(default=0, ge=0)
    ga4_tokens_remaining_hour: int = Field(default=0, ge=0)
    wp_requests: int = Field(default=0, ge=0)
    posts_upserted: int = Field(default=0, ge=0)
    posts_deleted: int = Field(default=0, ge=0)
    rows_written: int = Field(default=0, ge=0)
    duration_ms: int = Field(default=0, ge=0)
