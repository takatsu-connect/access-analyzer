"""E2E のフィクスチャをローカルの Supabase に読み込むコマンド（07 §10）。

    PYTHONPATH=src;tests  python -m support.load_e2e_fixture [--stale]

本物の日次バッチ（`pipeline.run_batch` の backfill）を、偽の GA4 と WP（support.e2e_fixture）で
1 回動かす。伏せ値と派生指標はバッチが計算するので、実装と必ず一致する。

- 接続先はローカルだけ（support.localdb）。内部表を空にしてから読み込む。
- `batch_writer` を一時的に login にし、終わったら nologin に戻す。パスワードは出力しない。
- HTTP は respx で偽物に替える。偽物に替えていない宛先への HTTP は失敗にする。
- 基準日は実行時刻の JST の前日。`--stale` を付けると、実行時刻を 6 日前として動かす
  （`pub_meta.is_stale` が true になる。「更新が遅れています」の確認に使う）。
- 結合テスト（tests/integration）は内部表を空にする。動かしたあとは読み込み直す。
"""

import argparse
import sys
from datetime import UTC, datetime, timedelta

import httpx
import psycopg
import pytest
import respx
from psycopg import sql
from psycopg.conninfo import make_conninfo
from pydantic import SecretStr

from support import e2e_fixture
from support.fake_ga4 import FakeGa4
from support.localdb import assert_disposable_database, local_admin_url, truncate_internal_tables
from support.localenv import local_setting
from takatsu_batch import pipeline, tz
from takatsu_batch.env import BatchEnv, DbTarget

PROPERTY_ID = "123456789"
HOOK_URL = "https://api.vercel.com/v1/integrations/deploy/prj_fake/hook_fake"
STALE_DAYS = 6
EXIT_NOT_READY = 2


class _InstantClock:
    """sleep で進む時計。待ち時間を実際には待たない。"""

    def __init__(self) -> None:
        self.time = 0.0

    def now(self) -> float:
        return self.time

    def sleep(self, seconds: float) -> None:
        self.time += seconds


def resolve_now(real_now: datetime, *, stale: bool) -> datetime:
    """バッチに渡す実行時刻。--stale なら 6 日前。基準日はこの時刻の JST の前日になる。"""
    return real_now - timedelta(days=STALE_DAYS) if stale else real_now


def run_backfill(writer_url: str, now: datetime) -> int:
    """偽の GA4 と WP で `pipeline.run_batch`（backfill）を 1 回動かす。終了コードを返す。

    writer_url は batch_writer の接続文字列。表を空にするのと login の切り替えは呼び出し側が行う。
    """
    base = tz.yesterday_jst(now)
    env = BatchEnv(
        db=DbTarget(url=SecretStr(writer_url), is_local=True),
        ga4_property_id=SecretStr(PROPERTY_ID),
        deploy_hook_url=SecretStr(HOOK_URL),
    )
    clock = _InstantClock()
    wp = e2e_fixture.build_wp(base)
    wp.clock = clock.now
    ga4 = FakeGa4(e2e_fixture.ga4_responses(base))
    # assert_all_mocked: 偽物に替えていない宛先への HTTP を失敗にする（外部に接続しない）
    with respx.mock(assert_all_called=False, assert_all_mocked=True) as router:
        router.post(HOOK_URL).mock(
            return_value=httpx.Response(201, json={"job": {"id": "fake-job", "state": "PENDING"}})
        )
        wp.install(router)
        with httpx.Client() as http:
            deps = pipeline.Deps(
                http=http,
                ga4_factory=lambda: ga4,
                sleep=clock.sleep,
                clock=clock.now,
                now=lambda: now,
            )
            return pipeline.run_batch(pipeline.RunRequest("backfill"), env, deps)


def load(*, stale: bool) -> int:
    """接続先の検査、内部表を空にする、batch_writer の login、読み込み、nologin に戻す。"""
    admin_url = local_admin_url()
    secret = local_setting("LOCAL_BATCH_WRITER_PASSWORD")
    if not secret:
        pytest.fail("LOCAL_BATCH_WRITER_PASSWORD がない", pytrace=False)
    assert_disposable_database(admin_url)
    truncate_internal_tables(admin_url)
    now = resolve_now(datetime.now(UTC), stale=stale)
    set_login = sql.SQL("alter role batch_writer login password {}").format(sql.Literal(secret))
    with psycopg.connect(admin_url, autocommit=True) as conn:
        conn.execute(set_login)
    try:
        return run_backfill(make_conninfo(admin_url, user="batch_writer", password=secret), now)
    finally:
        with psycopg.connect(admin_url, autocommit=True) as conn:
            conn.execute("alter role batch_writer nologin password null")


def main(argv: list[str] | None = None) -> int:
    """引数を読んで load を呼ぶ。成功は 0、バッチの失敗は 1、準備が足りないときは 2。"""
    parser = argparse.ArgumentParser(
        prog="python -m support.load_e2e_fixture",
        description="E2E のフィクスチャをローカルの Supabase に読み込む",
    )
    parser.add_argument(
        "--stale",
        action="store_true",
        help=f"実行時刻を {STALE_DAYS} 日前として動かす（pub_meta.is_stale が true になる）",
    )
    args = parser.parse_args(argv)
    try:
        return load(stale=args.stale)
    except (pytest.skip.Exception, pytest.fail.Exception) as exc:
        # support.localdb の検査の結果。文言は固定で、接続文字列などの値を含まない
        print(f"読み込めません: {exc}", file=sys.stderr)
        return EXIT_NOT_READY


if __name__ == "__main__":
    sys.exit(main())
