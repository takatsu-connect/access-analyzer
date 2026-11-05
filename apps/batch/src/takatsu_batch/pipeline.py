"""日次バッチの工程の順序（03 §1）。工程の中身は各モジュールにある。

失敗の扱い（03 §14）: どの工程で失敗しても、工程名と種別だけをログと batch_run に残し、
終了コード 1 を返す。例外の情報は種別への分類にだけ使う。通知は GitHub の失敗メールに任せる。
"""

import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date, datetime

import httpx

from takatsu_batch import db, derive, ga4_daily, ga4_period, period, publish, tz, wp_fetch, write
from takatsu_batch.config import BACKFILL_START, MASK_THRESHOLD
from takatsu_batch.env import BatchEnv
from takatsu_batch.errors import BatchValidationError, classify_error
from takatsu_batch.ga4_client import Ga4Api, Ga4Client
from takatsu_batch.log import ErrorKind, Step, log_count, log_duration, log_error, log_step
from takatsu_batch.models import RunCounts

type RunMode = db.RunMode


@dataclass(frozen=True, slots=True)
class Deps:
    """外部とのつなぎ目。テストはここを差し替える。"""

    http: httpx.Client
    ga4_factory: Callable[[], Ga4Api]
    sleep: Callable[[float], None] = time.sleep
    clock: Callable[[], float] = time.monotonic
    now: Callable[[], datetime] = tz.now_utc


@dataclass(frozen=True, slots=True)
class RunRequest:
    mode: RunMode
    backfill_from: date | None = None
    backfill_to: date | None = None


class _Tracker:
    """いまの工程と実行の行を覚えておき、失敗時の記録に使う。"""

    def __init__(self, env: BatchEnv, deps: Deps) -> None:
        self._env = env
        self._deps = deps
        self._started = deps.clock()
        self.step: Step = "startup"
        self.run_id: int | None = None
        self.counts = RunCounts()
        self.wp_client: wp_fetch.WpClient | None = None
        self.ga4_client: Ga4Client | None = None

    @contextmanager
    def scope(self, step: Step) -> Iterator[None]:
        self.step = step
        started = self._deps.clock()
        log_step(step, "start")
        yield
        log_duration(step, int((self._deps.clock() - started) * 1000))
        log_step(step, "end")

    def finalize_counts(self) -> None:
        """所要時間と、ここまでのリクエスト数。失敗したときも残す（割当の残量が分かるように）。"""
        update: dict[str, int] = {"duration_ms": int((self._deps.clock() - self._started) * 1000)}
        if self.wp_client is not None:
            update["wp_requests"] = self.wp_client.requests
        if self.ga4_client is not None:
            usage = self.ga4_client.usage
            update |= {"ga4_requests": usage.requests, "ga4_tokens": usage.tokens}
            if usage.remaining_day is not None:
                update["ga4_tokens_remaining_day"] = usage.remaining_day
            if usage.remaining_hour is not None:
                update["ga4_tokens_remaining_hour"] = usage.remaining_hour
        self.counts = self.counts.model_copy(update=update)

    def log_counts(self) -> None:
        counts = self.counts
        log_count(self.step, "wp_requests", counts.wp_requests)
        log_count(self.step, "ga4_requests", counts.ga4_requests)
        log_count(self.step, "ga4_tokens", counts.ga4_tokens)
        log_count(self.step, "ga4_tokens_remaining_day", counts.ga4_tokens_remaining_day)
        log_count(self.step, "ga4_tokens_remaining_hour", counts.ga4_tokens_remaining_hour)
        log_count(self.step, "posts_upserted", counts.posts_upserted)
        log_count(self.step, "posts_deleted", counts.posts_deleted)
        log_count(self.step, "rows_written", counts.rows_written)

    def record_failure(self, kind: ErrorKind) -> None:
        """batch_run への記録が失敗しても出力しない（03 §14 の 6）。"""
        log_error(self.step, kind)
        if self.run_id is None or self.step == "startup":
            return
        try:
            self.finalize_counts()
            with db.connect(self._env.db) as conn:
                db.finish_run_failed(conn, self.run_id, self.step, kind, self.counts)
        except BaseException:  # noqa: S110  # 記録の失敗は終了コードで知らせる
            pass


def resolve_base_date(request: RunRequest, env: BatchEnv, now: datetime) -> date:
    """基準日（03 §3）。backfill の to、BASE_DATE、JST の前日の順に使う。未来は認めない。"""
    latest = tz.yesterday_jst(now)
    base = request.backfill_to or env.base_date or latest
    start = request.backfill_from or date.fromisoformat(BACKFILL_START)
    if base > latest or base < start or start < date.fromisoformat(BACKFILL_START):
        raise BatchValidationError
    return base


def _run_steps(request: RunRequest, env: BatchEnv, deps: Deps, tracker: _Tracker) -> None:
    full = request.mode == "backfill"
    # backfill の from の既定は計測開始日（03 §10）。resolve_base_date が範囲を検査する
    backfill_from = (request.backfill_from or date.fromisoformat(BACKFILL_START)) if full else None
    started_at = deps.now()

    with tracker.scope("preflight"):
        base_date = resolve_base_date(request, env, started_at)
        with db.connect(env.db) as conn:
            db.close_abandoned_runs(conn, started_at)
            # データが揃う前に始まった成功は数えない。早い時刻の手動実行で定時の実行を止めないため
            if not full and db.has_success(conn, base_date, tz.ga4_ready_at(base_date)):
                log_step("preflight", "skip")
                return
            tracker.run_id = db.start_run(
                conn, started_at, base_date, request.mode, MASK_THRESHOLD, env.github_run_id
            )
            conn.commit()
            prior = db.read_prior_state(conn)

    with tracker.scope("wp_fetch"):
        tracker.wp_client = wp_fetch.WpClient(deps.http, deps.sleep, deps.clock)
        wp = wp_fetch.fetch(tracker.wp_client, prior, base_date, full=full)
        # GA4 の取得と集計は、基準日までに公開された記事だけを対象にする
        posts = wp.measurable_posts(base_date)
        log_count("wp_fetch", "posts_late_seen", wp.late_seen)

    with tracker.scope("period"):
        plan = period.plan_periods(
            base_date,
            prior_confirmed=prior.confirmed_months,
            referrer_months=prior.referrer_months,
            city_months=prior.city_months,
            full=full,
        )

    with tracker.scope("ga4_daily"):
        client = Ga4Client(deps.ga4_factory(), env.ga4_property_id, deps.sleep, stop_low_quota=full)
        tracker.ga4_client = client
        daily = ga4_daily.fetch(
            client,
            ga4_daily.fetch_ranges(base_date, backfill_from),
            frozenset(posts),
        )

    with tracker.scope("ga4_period"):
        fetched = ga4_period.fetch(
            client,
            plan,
            posts,
            prior.referrer_computed,
            base_date,
            full=full,
        )

    with tracker.scope("derive"):
        with db.connect(env.db) as conn:
            inputs = db.read_derive_inputs(conn)
            conn.commit()
        output = derive.derive(wp, plan, daily, fetched, inputs, prior, base_date)

    with tracker.scope("write"):
        with db.connect(env.db) as conn:
            result = write.write_all(conn, output)
        tracker.counts = tracker.counts.model_copy(
            update={
                "posts_upserted": len(wp.changed_posts),
                "posts_deleted": result.posts_deleted,
                "rows_written": result.rows_written,
            }
        )

    with tracker.scope("publish"):
        publish.call_deploy_hook(deps.http, env.deploy_hook_url)

    tracker.finalize_counts()
    tracker.log_counts()
    with db.connect(env.db) as conn:
        db.finish_run_success(conn, tracker.run_id, deps.now(), tracker.counts)


def run_batch(request: RunRequest, env: BatchEnv, deps: Deps) -> int:
    """daily と backfill。終了コードを返す。"""
    tracker = _Tracker(env, deps)
    try:
        _run_steps(request, env, deps, tracker)
    except BaseException as exc:
        tracker.record_failure(classify_error(exc))
        return 1
    return 0
