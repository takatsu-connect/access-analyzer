#!/usr/bin/env bash
# CI のジョブの中で起動した Supabase ローカルへの接続情報を GITHUB_ENV に書く（07 §2）。
# すべてローカル（127.0.0.1）の値で、本番の値はここに来ない。値はログに出さない。
# ポートは supabase/config.toml（api 54421、db 54422）に合わせる。
set -euo pipefail

: "${GITHUB_ENV:?}" "${SUPABASE_CLI_VERSION:?}"

status_env="$(npx --yes "supabase@${SUPABASE_CLI_VERSION}" status -o env 2>/dev/null)"
# 版によって ANON_KEY と SUPA_ANON_KEY の綴りがあるので、両方を受ける。値の引用符を外す
anon_key="$(printf '%s\n' "${status_env}" | sed -n -E 's/^(SUPA_)?ANON_KEY="?([^"]*)"?$/\2/p' | head -n 1)"
if [ -z "${anon_key}" ]; then
  echo "supabase status から anon キーを読めません（CLI の版で出力の形が変わった可能性）" >&2
  exit 1
fi

# batch_writer のパスワードは、このジョブだけで使う使い捨ての値（英数字。ADR 0009）
batch_writer_password="$(openssl rand -hex 24)"

{
  echo "DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres"
  echo "SUPABASE_LOCAL_API_URL=http://127.0.0.1:54421"
  echo "SUPABASE_LOCAL_ANON_KEY=${anon_key}"
  echo "LOCAL_BATCH_WRITER_PASSWORD=${batch_writer_password}"
  # BI のビルドが読む名前（Vercel の環境変数と同じ名前。値はローカル）
  echo "SUPABASE_URL=http://127.0.0.1:54421"
  echo "SUPABASE_ANON_KEY=${anon_key}"
} >> "${GITHUB_ENV}"

echo "Supabase ローカルの接続情報を設定しました（6 件）"
