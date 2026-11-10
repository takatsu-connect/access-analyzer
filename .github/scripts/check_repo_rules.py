"""ワークフローの規律（07 S-10）、.env.example の形（S-15）、公開の環境変数名（S-01）を確かめる。

標準ライブラリだけで動く（CI の static ジョブとローカルの両方）。YAML を解析せず、行の形で判定する。
ワークフローの書き方をこの検査が読める形（2 字下げ、ジョブ名は `  name:` の行）に揃えている。
違反があれば一覧を出して終了コード 1。違反の行の中身は出さない（ファイル名と規則だけ）。

実行: python3 .github/scripts/check_repo_rules.py（リポジトリ直下で）
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = ROOT / ".github" / "workflows"

SHA_USES = re.compile(r"^\s*(?:-\s+)?uses:\s+([A-Za-z0-9_.-]+/[A-Za-z0-9_./-]+)@[0-9a-f]{40}\s+#\s*v\S+\s*$")
USES = re.compile(r"^\s*(?:-\s+)?uses:\s")
JOB_HEADER = re.compile(r"^  ([A-Za-z0-9_-]+):\s*$")
RUN_LINE = re.compile(r"^(\s*)(?:-\s+)?run:\s*(.*)$")
ENV_KEY = re.compile(r"^\s+(PG[A-Z_]*|SSL_CERT_FILE|SSL_CERT_DIR|REQUESTS_CA_BUNDLE|HTTPS?_PROXY|ALL_PROXY|https?_proxy|all_proxy)\s*:")
ENV_EXAMPLE_LINE = re.compile(r"^[A-Z][A-Z0-9_]*=$")

# 03 §16、06 §3 の名前と、ローカルの結合テストの名前（07 §2）
ENV_EXAMPLE_NAMES = {
    "GCP_WORKLOAD_IDENTITY_PROVIDER",
    "GCP_SERVICE_ACCOUNT",
    "GA4_PROPERTY_ID",
    "SUPABASE_BATCH_DB_URL",
    "VERCEL_DEPLOY_HOOK_URL",
    "WP_RELAY_URL",
    "WP_RELAY_TOKEN",
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "BI_GA4_MEASUREMENT_ID",
    "LOCAL_BATCH_WRITER_PASSWORD",
    "DATABASE_URL",
    "SUPABASE_LOCAL_API_URL",
    "SUPABASE_LOCAL_ANON_KEY",
}

DAILY_ALLOWED_ACTIONS = {"actions/checkout", "actions/setup-python", "google-github-actions/auth"}
ID_TOKEN_FILES = {"daily.yml", "wif-check.yml"}
ENV_SECRET_JOBS = {"daily", "backfill", "publish_only"}
DB_URL_JOBS = {"daily", "backfill"}

errors: list[str] = []


def fail(path: Path | str, rule: str) -> None:
    name = path.name if isinstance(path, Path) else path
    errors.append(f"{name}: {rule}")


def strip_comment(line: str) -> str:
    """行末と行全体のコメントを外す（引用符の中の # は考えない。ワークフローの書き方で避ける）。"""
    if line.lstrip().startswith("#"):
        return ""
    return re.sub(r"\s+#.*$", "", line)


def top_block(lines: list[str], key: str) -> list[str] | None:
    """最上位のキー（字下げなし）の下の行。キーがなければ None。"""
    for i, line in enumerate(lines):
        if line.rstrip() == f"{key}:":
            block = []
            for nxt in lines[i + 1 :]:
                if nxt and not nxt.startswith((" ", "#")):
                    break
                if strip_comment(nxt).strip():
                    block.append(strip_comment(nxt).strip())
            return block
    return None


def jobs_of(lines: list[str]) -> dict[str, list[str]]:
    """jobs: の下を、ジョブ名ごとの行に分ける。"""
    jobs: dict[str, list[str]] = {}
    in_jobs = False
    current: str | None = None
    for line in lines:
        if line.rstrip() == "jobs:":
            in_jobs = True
            continue
        if in_jobs and line and not line.startswith((" ", "#")):
            in_jobs = False
            current = None
        if not in_jobs:
            continue
        m = JOB_HEADER.match(line)
        if m:
            current = m.group(1)
            jobs[current] = []
        elif current is not None:
            jobs[current].append(line)
    return jobs


def run_bodies(lines: list[str]) -> list[str]:
    """run: の中身（1 行の形と | の形の両方）。"""
    bodies: list[str] = []
    i = 0
    while i < len(lines):
        m = RUN_LINE.match(lines[i])
        if not m:
            i += 1
            continue
        indent, value = len(m.group(1)), m.group(2)
        if value.strip() in ("|", ">", "|-", ">-"):
            body = []
            i += 1
            while i < len(lines) and (not lines[i].strip() or len(lines[i]) - len(lines[i].lstrip()) > indent):
                body.append(lines[i])
                i += 1
            bodies.append("\n".join(body))
        else:
            bodies.append(value)
            i += 1
    return bodies


def check_workflow(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    code_lines = [strip_comment(line) for line in lines]
    code = "\n".join(code_lines)
    name = path.name

    perms = top_block(lines, "permissions")
    if perms is None:
        fail(path, "最上位に permissions: がない")
    elif name != "heartbeat.yml" and perms != ["contents: read"]:
        fail(path, "最上位の permissions が contents: read だけではない")

    if "pull_request_target" in code:
        fail(path, "pull_request_target を使っている")

    for raw in lines:
        if USES.match(raw) and not SHA_USES.match(raw):
            fail(path, "uses: が 40 桁の SHA と版のコメントで固定されていない")

    if "astral-sh/" in code:
        fail(path, "astral-sh/ の Action を使っている")

    for line in code_lines:
        if re.search(r"^\s+id-token:\s*write", line) and name not in ID_TOKEN_FILES:
            fail(path, "id-token: write は GCP 認証のワークフローだけ")
        if re.search(r"contents:\s*write", line) and name != "heartbeat.yml":
            fail(path, "contents: write は heartbeat.yml だけ")
        if ENV_KEY.match(line):
            fail(path, "PG で始まる環境変数、証明書の場所、プロキシを設定している")
        if re.search(r"^\s+environment:", line) and name != "daily.yml":
            fail(path, "environment: は daily.yml だけ")
        if re.search(r"\bpip install\b", line) and "--require-hashes --only-binary :all:" not in line:
            fail(path, "pip install に --require-hashes --only-binary :all: がない")

    if re.search(r"gh pr merge|--auto\b|automerge|auto-merge", code):
        fail(path, "自動 merge の記述がある")

    for body in run_bodies(code_lines):
        if "${{" in body:
            fail(path, "run: の中で ${{ }} を展開している（env 経由で渡す）")
        if re.search(r"\b(printenv|env)\s*$|\bprintenv\b|set -x|ACTIONS_STEP_DEBUG", body, re.MULTILINE):
            fail(path, "環境変数の一覧やデバッグ出力を出している")

    jobs = jobs_of(lines)
    if not jobs:
        fail(path, "jobs: が読めない")
    has_schedule = re.search(r"^  schedule:", code, re.MULTILINE) is not None
    for job, body_lines in jobs.items():
        body = "\n".join(strip_comment(line) for line in body_lines)
        if has_schedule and "github.ref == 'refs/heads/main'" not in body:
            fail(path, f"schedule のあるワークフローのジョブ {job} に main の条件がない")
        uses_secret_env = re.search(r"secrets\.(SUPABASE_BATCH_DB_URL|VERCEL_DEPLOY_HOOK_URL|WP_RELAY_)", body)
        if uses_secret_env and not re.search(r"^    environment:\s*production\s*$", body, re.MULTILINE):
            fail(path, f"ジョブ {job} が Environment の Secret を参照するのに environment: production がない")
        if "secrets.SUPABASE_BATCH_DB_URL" in body and (name != "daily.yml" or job not in DB_URL_JOBS):
            fail(path, f"ジョブ {job} が SUPABASE_BATCH_DB_URL を参照している（daily と backfill だけ）")
        if "secrets.WP_RELAY_" in body and (name != "daily.yml" or job not in DB_URL_JOBS):
            fail(path, f"ジョブ {job} が WP_RELAY_ の Secret を参照している（daily と backfill だけ）")
        if name == "daily.yml" and job == "publish_only":
            if re.search(r"secrets\.(?!VERCEL_DEPLOY_HOOK_URL\b)", body) or "id-token" in body:
                fail(path, "publish_only に Deploy Hook 以外の Secret か id-token がある")
        if name == "daily.yml" and job not in ENV_SECRET_JOBS:
            fail(path, f"daily.yml に想定外のジョブ {job} がある")

    if name == "daily.yml":
        for raw in lines:
            m = SHA_USES.match(raw)
            if m and m.group(1) not in DAILY_ALLOWED_ACTIONS:
                fail(path, "daily.yml の uses: が checkout、setup-python、auth 以外を含む")
        if "--require-hashes --only-binary :all:" not in code:
            fail(path, "daily.yml の pip install にハッシュと wheel の指定がない")

    if name == "heartbeat.yml":
        if perms != ["contents: write"]:
            fail(path, "heartbeat.yml の permissions が contents: write だけではない")
        for raw in lines:
            m = SHA_USES.match(raw)
            if m and m.group(1) != "actions/checkout":
                fail(path, "heartbeat.yml に actions/checkout 以外の uses: がある")
        if re.search(r"\b(pnpm|npm|node|pip|python3?)\b", "\n".join(run_bodies(code_lines))):
            fail(path, "heartbeat.yml の run: に pnpm、npm、node、pip、python がある")
        if "secrets." in code or "id-token" in code:
            fail(path, "heartbeat.yml が Secrets か id-token を参照している")

    if name == "audit.yml":
        if not has_schedule:
            fail(path, "audit.yml に schedule がない")
        if "secrets." in code or "id-token" in code or "environment:" in code:
            fail(path, "audit.yml が Secrets、id-token、Environment を参照している")


def check_dependabot() -> None:
    path = ROOT / ".github" / "dependabot.yml"
    if not path.exists():
        fail(".github/dependabot.yml", "ない")
        return
    text = path.read_text(encoding="utf-8")
    entries = text.count("package-ecosystem:")
    if entries == 0 or text.count("cooldown:") < entries:
        fail(path, "すべての更新の設定に cooldown がない")
    if re.search(r"automerge|auto-merge", text):
        fail(path, "自動 merge の記述がある")


def check_env_example() -> None:
    path = ROOT / ".env.example"
    names: set[str] = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        if not ENV_EXAMPLE_LINE.match(line):
            fail(path, "名前= 以外の行（値か形の誤り）がある")
            continue
        names.add(line[:-1])
    if names != ENV_EXAMPLE_NAMES:
        fail(path, "名前の一覧が 03 §16 と 06 §3 の一覧と一致しない")


def check_public_env_names() -> None:
    """S-01: NEXT_PUBLIC_ と SUPABASE をつないだ名前を、文書と検査の道具の外で禁止する。"""
    needle = "NEXT_PUBLIC_" + "SUPABASE"
    skip_dirs = {".git", "node_modules", ".next", "docs", ".beads", ".claude", ".venv", ".mypy_cache"}
    skip_files = {ROOT / "apps" / "web" / "scripts" / "check-public-env-names.mjs"}
    for path in ROOT.rglob("*"):
        if not path.is_file() or path in skip_files:
            continue
        if any(part in skip_dirs for part in path.relative_to(ROOT).parts):
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        if needle in text:
            fail(str(path.relative_to(ROOT)), "S-01 の禁止された名前がある")


def main() -> int:
    paths = sorted(WORKFLOWS.glob("*.y*ml"))
    if not paths:
        fail(".github/workflows", "ワークフローがない")
    for path in paths:
        check_workflow(path)
    check_dependabot()
    check_env_example()
    check_public_env_names()
    if errors:
        for line in errors:
            sys.stdout.write(f"NG {line}\n")
        sys.stdout.write(f"違反 {len(errors)} 件\n")
        return 1
    sys.stdout.write(f"OK ワークフロー {len(paths)} 本、dependabot.yml、.env.example、S-01\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
