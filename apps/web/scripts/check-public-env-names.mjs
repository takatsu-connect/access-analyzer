/**
 * S-01（docs/design/07_test_plan.md §7、NFR-42）。
 *
 * リポジトリ全体に、Supabase のキーをブラウザへ渡す名前の文字列がないことを確かめる。
 * 1 件でもあれば終了コード 1。docs と、この検査スクリプト自身は対象外。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NEEDLE = 'NEXT_PUBLIC_SUPABASE';

const SELF = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SELF), '..', '..', '..');

// 生成物、依存、履歴、文書、鍵の置き場は読まない。
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  '.next',
  'docs',
  'out',
  'coverage',
  'playwright-report',
  'test-results',
  'credentials',
  '.beads',
  '.dolt',
  '.venv',
  '__pycache__',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
]);
const MAX_BYTES = 2 * 1024 * 1024;

/** @param {string} dir @returns {string[]} */
function listFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) files.push(...listFiles(fullPath));
    } else if (entry.isFile() && fullPath !== SELF) {
      files.push(fullPath);
    }
  }
  return files;
}

const hits = [];
for (const file of listFiles(REPO_ROOT)) {
  if (statSync(file).size > MAX_BYTES) continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    if (line.includes(NEEDLE)) {
      hits.push(`${path.relative(REPO_ROOT, file).replaceAll('\\', '/')}:${index + 1}`);
    }
  });
}

if (hits.length > 0) {
  process.stderr.write(`S-01: ${NEEDLE} を含む行が ${hits.length} 件あります。\n`);
  for (const hit of hits) process.stderr.write(`  ${hit}\n`);
  process.exit(1);
}
process.stdout.write(`S-01: ${NEEDLE} を含む行はありません。\n`);
