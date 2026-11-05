"""I-B の土台（07 §5）。ローカルの Supabase に batch_writer で接続し、外部は偽物に替える。

バッチは実際にコミットするので、テストの前後で内部表を空にする。接続先がローカルであることは
tests/conftest.py の admin_url が確かめる。対象サイト、本番の Supabase、GA4 には接続しない。
"""

from collections.abc import Callable, Iterator, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import httpx
import psycopg
import pytest
import respx
from psycopg import sql
from pydantic import SecretStr

from support import batch_scenario as scenario
from support.fake_ga4 import FakeGa4
from support.fake_wp import FakeWp
from support.localdb import assert_disposable_database
from takatsu_batch import pipeline
from takatsu_batch.env import BatchEnv, DbTarget
from takatsu_batch.write import BATCH_WRITABLE_TABLES

type Query = Callable[..., list[tuple[Any, ...]]]

_TABLES = (*(spec.name for spec in BATCH_WRITABLE_TABLES), "batch_run")


def _truncate(admin_url: str) -> None:
    assert_disposable_database(admin_url)
    statement = sql.SQL("truncate {} restart identity cascade").format(
        sql.SQL(", ").join(sql.Identifier("internal", name) for name in _TABLES)
    )
    with psycopg.connect(admin_url, autocommit=True) as conn:
        conn.execute(statement)


@pytest.fixture
def clean_db(admin_url: str) -> Iterator[None]:
    _truncate(admin_url)
    yield
    _truncate(admin_url)


@pytest.fixture
def query(admin_url: str, clean_db: None) -> Query:
    """管理接続で読む。行は tuple の list。"""

    def run(statement: str, params: Sequence[Any] = ()) -> list[tuple[Any, ...]]:
        with psycopg.connect(admin_url, autocommit=True) as conn:
            return conn.execute(statement.encode(), params).fetchall()

    return run


class FakeClock:
    """sleep で進む時計。待ち時間を実際には待たない。"""

    def __init__(self) -> None:
        self.time = 0.0
        self.sleeps: list[float] = []

    def now(self) -> float:
        return self.time

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.time += seconds


@dataclass
class Harness:
    env: BatchEnv
    router: respx.MockRouter
    hook: respx.Route
    wp: FakeWp
    ga4: FakeGa4
    clock: FakeClock = field(default_factory=FakeClock)
    now: datetime = scenario.NOW

    def run(self, request: pipeline.RunRequest | None = None) -> int:
        with httpx.Client() as http:
            deps = pipeline.Deps(
                http=http,
                ga4_factory=lambda: self.ga4,
                sleep=self.clock.sleep,
                clock=self.clock.now,
                now=lambda: self.now,
            )
            return pipeline.run_batch(request or pipeline.RunRequest("daily"), self.env, deps)


@pytest.fixture
def harness(batch_writer_url: str, clean_db: None) -> Iterator[Harness]:
    env = BatchEnv(
        db=DbTarget(url=SecretStr(batch_writer_url), is_local=True),
        ga4_property_id=SecretStr(scenario.PROPERTY_ID),
        deploy_hook_url=SecretStr(scenario.HOOK_URL),
    )
    with respx.mock(assert_all_called=False) as router:
        hook = router.post(scenario.HOOK_URL).mock(
            return_value=httpx.Response(201, json={"job": {"id": "fake-job", "state": "PENDING"}})
        )
        clock = FakeClock()
        wp = scenario.build_wp()
        wp.clock = clock.now
        wp.install(router)
        yield Harness(
            env=env,
            router=router,
            hook=hook,
            wp=wp,
            ga4=FakeGa4(scenario.ga4_responses()),
            clock=clock,
        )
