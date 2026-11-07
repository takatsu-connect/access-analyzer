#!/usr/bin/env bash
# pip-audit（06 §10、07 S-08）。ci.yml と audit.yml の両方から呼ぶ。
# 深刻度で絞れないので、脆弱性が 1 件でもあれば失敗にする。
# 誤検知と修正版のないものは、下の IGNORES に「ID  理由」の形で足す（理由を必ず書く）。
# --disable-pip: ハッシュ固定の requirements を pip で解決し直さない（ADR 0009 V-6 で要確認）。
set -euo pipefail

IGNORES=(
  # 例: "GHSA-xxxx-xxxx-xxxx  修正版がなく、バッチの使い方では到達しない（確認日と根拠）"
)

args=(--require-hashes --disable-pip --progress-spinner off -r apps/batch/requirements.txt)
for entry in "${IGNORES[@]}"; do
  args+=(--ignore-vuln "${entry%% *}")
done

python -m pip_audit "${args[@]}"
