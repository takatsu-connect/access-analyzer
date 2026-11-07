#!/usr/bin/env bash
# actionlint と gitleaks のバイナリを、ワークフローの env で固定した版とチェックサムで入れる（07 S-09、S-10）。
# gitleaks-action は使わない（organization のリポジトリでライセンスキーが要るため）。
set -euo pipefail

: "${ACTIONLINT_VERSION:?}" "${ACTIONLINT_SHA256:?}" "${GITLEAKS_VERSION:?}" "${GITLEAKS_SHA256:?}" "${RUNNER_TEMP:?}"

bin_dir="${RUNNER_TEMP}/bin"
work_dir="${RUNNER_TEMP}/tools"
mkdir -p "${bin_dir}" "${work_dir}"

fetch_and_verify() {
  local url="$1" sha256="$2" out="$3"
  curl -fsSL --retry 3 -o "${out}" "${url}"
  echo "${sha256}  ${out}" | sha256sum -c --quiet -
}

actionlint_tgz="${work_dir}/actionlint.tar.gz"
fetch_and_verify \
  "https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/actionlint_${ACTIONLINT_VERSION}_linux_amd64.tar.gz" \
  "${ACTIONLINT_SHA256}" "${actionlint_tgz}"
tar -xzf "${actionlint_tgz}" -C "${bin_dir}" actionlint

gitleaks_tgz="${work_dir}/gitleaks.tar.gz"
fetch_and_verify \
  "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" \
  "${GITLEAKS_SHA256}" "${gitleaks_tgz}"
tar -xzf "${gitleaks_tgz}" -C "${bin_dir}" gitleaks

"${bin_dir}/actionlint" -version
"${bin_dir}/gitleaks" version
