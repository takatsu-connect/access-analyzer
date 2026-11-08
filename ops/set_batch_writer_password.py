"""batch_writer のパスワードを作り直し、本番の Supabase に設定して、GitHub の Environment Secret に登録する。

使う場面: 初回の本番化（docs/operations/deploy.md 手順 4・5）と、パスワードのローテーション（runbook.md）。

- パスワードは英数字 40 文字（ADR 0009: URL エンコードの要らない英数字、32 文字以上）をここで作り、画面にもファイルにも出さない。
- データベースには平文を送らず、SCRAM-SHA-256 の検証子（元に戻せない値）にしてから
  `alter role ... password` に渡す。SQL の履歴やログに平文が残らない（ADR 0009 の確認項目 3、
  監査 2026-11-07-workflows-review.md の低）。
- 接続文字列は GitHub の Environment `production` の Secret `SUPABASE_BATCH_DB_URL` に、標準入力で渡す。

前提: リポジトリ直下で `npx supabase@3.0.0 link` 済み（supabase/.temp/pooler-url がある）、
`npx supabase@3.0.0 login` 済み、`gh` が takatsu-connect/access-analyzer に書き込める。

    python ops/set_batch_writer_password.py            # 本番に設定して Secret に登録する
    python ops/set_batch_writer_password.py --self-test  # 検証子の作り方だけを確かめる（何も変えない）
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import pathlib
import re
import secrets
import string
import subprocess
import sys

REPO = "takatsu-connect/access-analyzer"
ENVIRONMENT = "production"
SECRET_NAME = "SUPABASE_BATCH_DB_URL"
SUPABASE_CLI = ["npx", "--yes", "supabase@3.0.0"]
ROOT = pathlib.Path(__file__).resolve().parent.parent
POOLER_URL_FILE = ROOT / "supabase" / ".temp" / "pooler-url"
PROJECT_REF_FILE = ROOT / "supabase" / ".temp" / "project-ref"
ITERATIONS = 4096


def new_password(length: int = 40) -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def scram_verifier(password: str, salt: bytes | None = None, iterations: int = ITERATIONS) -> str:
    """PostgreSQL の pg_authid.rolpassword と同じ形の SCRAM-SHA-256 の検証子を作る（RFC 5802、7677）。"""
    salt = salt if salt is not None else secrets.token_bytes(16)
    salted = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    client_key = hmac.new(salted, b"Client Key", hashlib.sha256).digest()
    stored_key = hashlib.sha256(client_key).digest()
    server_key = hmac.new(salted, b"Server Key", hashlib.sha256).digest()
    b64 = lambda raw: base64.b64encode(raw).decode("ascii")  # noqa: E731
    return f"SCRAM-SHA-256${iterations}:{b64(salt)}${b64(stored_key)}:{b64(server_key)}"


def self_test() -> None:
    # RFC 7677 §3 の例（user / pencil）の StoredKey と ServerKey と同じになることを確かめる。
    salt = base64.b64decode("W22ZaJ0SNY7soEsUEjb6gQ==")
    expected = (
        "SCRAM-SHA-256$4096:W22ZaJ0SNY7soEsUEjb6gQ=="
        "$WG5d8oPm3OtcPnkdi4Uo7BkeZkBFzpcXkuLmtbsT4qY=:wfPLwcE6nTWhTAmQ7tl2KeoiWGPlZqQxSrmfPwDl2dU="
    )
    actual = scram_verifier("pencil", salt, 4096)
    if actual != expected:
        sys.exit("self-test: 検証子が RFC 7677 の例と一致しません")
    print("self-test: OK（RFC 7677 の例と一致）")


def pooler_parts() -> tuple[str, str]:
    """pooler の host と project ref を、link の記録から読む（値はどちらも秘密ではない）。"""
    url = POOLER_URL_FILE.read_text(encoding="utf-8").strip()
    match = re.match(r"^postgres(?:ql)?://[^@]+@([a-z0-9.-]+\.pooler\.supabase\.com):5432/postgres$", url)
    if match is None:
        sys.exit("pooler-url の形が想定と違います（supabase link をやり直してください）")
    ref = PROJECT_REF_FILE.read_text(encoding="utf-8").strip()
    if not re.fullmatch(r"[a-z0-9]{20}", ref):
        sys.exit("project-ref の形が想定と違います")
    return match.group(1), ref


def main() -> None:
    if "--self-test" in sys.argv:
        self_test()
        return
    self_test()
    host, ref = pooler_parts()
    password = new_password()
    verifier = scram_verifier(password)
    sql = f"alter role batch_writer login password '{verifier}'"
    # 検証子にも平文にも引用符は含まれない（base64 と英数字）。
    done = subprocess.run(
        [*SUPABASE_CLI, "db", "query", "--remote", "--yes", sql, "--workdir", str(ROOT)],
        stdin=subprocess.DEVNULL, capture_output=True, text=True, shell=sys.platform == "win32",
    )
    if done.returncode != 0:
        sys.exit("パスワードの設定に失敗しました（Supabase CLI の終了コード {}）".format(done.returncode))
    print("batch_writer に新しいパスワードを設定しました（値は表示しません）")
    url = f"postgresql://batch_writer.{ref}:{password}@{host}:5432/postgres"
    stored = subprocess.run(
        ["gh", "secret", "set", SECRET_NAME, "--repo", REPO, "--env", ENVIRONMENT],
        input=url, capture_output=True, text=True,
    )
    if stored.returncode != 0:
        sys.exit("GitHub の Secret の登録に失敗しました。パスワードは設定済みなので、もう一度このスクリプトを流して作り直してください")
    print(f"GitHub の Environment {ENVIRONMENT} に {SECRET_NAME} を登録しました（値は表示しません）")


if __name__ == "__main__":
    main()
