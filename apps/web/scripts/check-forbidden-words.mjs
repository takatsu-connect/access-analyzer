/**
 * S-05（docs/design/07_test_plan.md §7、NFR-97）。
 *
 * apps/web/src に禁止語がないことを確かめる。1 件でもあれば終了コード 1。
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FORBIDDEN_WORDS = ['偏り', '下位', '読まれなかった', '順位', 'ランキング'];

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET_DIR = path.join(WEB_ROOT, 'src');

/** @param {string} dir @returns {string[]} */
function listFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

const hits = [];
for (const file of listFiles(TARGET_DIR)) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    for (const word of FORBIDDEN_WORDS) {
      if (line.includes(word)) {
        const relativePath = path.relative(WEB_ROOT, file).replaceAll('\\', '/');
        hits.push(`${relativePath}:${index + 1} 「${word}」`);
      }
    }
  });
}

if (hits.length > 0) {
  process.stderr.write(`S-05: 禁止語が ${hits.length} 件あります。\n`);
  for (const hit of hits) process.stderr.write(`  ${hit}\n`);
  process.exit(1);
}
process.stdout.write('S-05: apps/web/src に禁止語はありません。\n');
