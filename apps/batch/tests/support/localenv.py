"""結合テストがローカルの Supabase に接続するための設定値（07 §2）。

環境変数になければ、リポジトリ直下の .env から読む。値を出力しない。
本番の値を .env に書かない（接続先がローカルであることは使う側が確かめる）。
"""

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]


def _read_dotenv(name: str) -> str | None:
    path = REPO_ROOT / ".env"
    if not path.exists():
        return None
    for line in path.read_text(encoding="utf-8").splitlines():
        key, separator, value = line.partition("=")
        if separator and key.strip() == name:
            return value.strip() or None
    return None


def local_setting(name: str) -> str | None:
    """環境変数を優先し、なければ .env の値。どちらにもなければ None。"""
    return os.environ.get(name) or _read_dotenv(name)
