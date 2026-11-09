// ビルド出力の検査（07 §6 の E-04、E-17。§7 の S-14。NFR-42、NFR-10。ADR 0010 の 7）。
//
// `pnpm run build` のあとに単独で流す:  pnpm run check:build
//
// 見るもの（ブラウザに配信されるものだけ）:
//   .next/static 配下のすべてのファイルと、.next/server/app 配下の HTML・RSC の出力
// 確かめること:
//   1. SUPABASE_URL の値（と、そのホスト名）、anon キーの先頭 20 文字、「supabase.co」がない
//   2. NEXT_PUBLIC_ で始まる環境変数名がない
//   3. HTML にインラインのイベント属性（onclick= など）がない
//   4. どの HTML も同じ時点のデータで作られている（DataStatus の文が 1 種類）
//   5. HTML の大きさが 04 §6 の目安以内（gzip 後。S-01 40 KB、S-02e 50 KB、S-03 20 KB。未圧縮の値も参考に出す）
//
// 値は process.env か .env.local から読む。値そのものは出力しない（見つかったか、とファイル名だけ）。
// 失敗は終了コード 1、検査の準備が足りないとき（ビルドがない、値がない）は 2。
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NEXT_DIR = path.join(WEB_ROOT, '.next');
const STATIC_DIR = path.join(NEXT_DIR, 'static');
const APP_DIR = path.join(NEXT_DIR, 'server', 'app');

// ブラウザに配信される形の出力（HTML、RSC のデータ、robots.txt などの本文）。
const SERVED_EXTENSIONS = ['.html', '.rsc', '.body'];
const KB = 1024;
// 04 §6 の目安（gzip 後の HTML。埋め込みの JSON を含む）。NFR-10 は表示の速さの要件で、
// 効くのは転送量なので、未圧縮ではなく gzip 後の大きさで見る（2026-11-06。未圧縮は表と図の
// マークアップで膨らむが、繰り返しが多く 1/8 前後に縮む）。
const SIZE_LIMITS = [
  { name: 'S-01（/）', limitKb: 40, match: (file) => file === 'index.html' },
  { name: 'S-02e（/articles）', limitKb: 50, match: (file) => file === 'articles.html' },
  {
    name: 'S-03（/articles/[postId]）',
    limitKb: 20,
    match: (file) => /^articles\/\d+\.html$/.test(file),
  },
];
// DataStatus の文（src/lib/ui-text.ts の status.asOf）の、基準日と更新時刻の部分。
const DATA_STATUS = /(\d+ 月 \d+ 日)までのデータです（(\d+ 月 \d+ 日 \d+:\d+) 更新）/;
// レイアウトを通らない（DataStatus を持たない）HTML。
const NO_LAYOUT = ['_global-error.html'];

function notReady(message) {
  process.stderr.write(`check-build-output: ${message}\n`);
  process.exit(2);
}

function listFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

/** .env.local の NAME=value を読む（引用符を外す）。値は外に出さない。 */
function readEnvFile(file) {
  const values = new Map();
  if (!existsSync(file)) return values;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (match === null) continue;
    values.set(match[1], match[2].replace(/^(['"])(.*)\1$/, '$2'));
  }
  return values;
}

function relative(file) {
  return path.relative(WEB_ROOT, file).replaceAll('\\', '/');
}

if (!existsSync(STATIC_DIR) || !existsSync(APP_DIR)) {
  notReady('.next がない。先に pnpm run build を実行する。');
}

const envFile = readEnvFile(path.join(WEB_ROOT, '.env.local'));
const supabaseUrl = (process.env.SUPABASE_URL ?? envFile.get('SUPABASE_URL') ?? '').trim();
const anonKey = (process.env.SUPABASE_ANON_KEY ?? envFile.get('SUPABASE_ANON_KEY') ?? '').trim();
if (supabaseUrl.length < 8 || anonKey.length < 20) {
  notReady(
    'SUPABASE_URL か SUPABASE_ANON_KEY が、環境変数にも .env.local にもない（または短すぎる）。',
  );
}

// 探す文字列。名前（label）だけを出力に使い、値（text）は出さない。
const needles = [
  { label: 'SUPABASE_URL の値', text: supabaseUrl.replace(/\/+$/, '') },
  { label: 'anon キーの先頭 20 文字', text: anonKey.slice(0, 20) },
  { label: '「supabase.co」', text: 'supabase.co' },
];
try {
  const { host } = new URL(supabaseUrl);
  if (host.length >= 8) needles.push({ label: 'SUPABASE_URL のホスト名', text: host });
} catch {
  notReady('SUPABASE_URL が URL の形でない。');
}

const staticFiles = listFiles(STATIC_DIR);
const servedFiles = listFiles(APP_DIR).filter((file) =>
  SERVED_EXTENSIONS.some((extension) => file.endsWith(extension)),
);
const htmlFiles = servedFiles.filter((file) => file.endsWith('.html'));
if (staticFiles.length === 0 || htmlFiles.length === 0) {
  // 原因を追えるよう、個数と拡張子の内訳だけを出す（ファイルの中身と環境変数は出さない）。
  const extensions = new Map();
  for (const file of listFiles(APP_DIR)) {
    const extension = path.extname(file);
    extensions.set(extension, (extensions.get(extension) ?? 0) + 1);
  }
  const vercelOutput = path.join(WEB_ROOT, '.vercel', 'output');
  notReady(
    `ビルド出力が空。pnpm run build をやり直す。` +
      ` static=${staticFiles.length} html=${htmlFiles.length}` +
      ` app の内訳=${JSON.stringify([...extensions])}` +
      ` .next=${JSON.stringify(readdirSync(NEXT_DIR).sort())}` +
      ` .vercel/output=${existsSync(vercelOutput)}`,
  );
}

const failures = [];
const fail = (check, file) => failures.push({ check, file });

// 1、2: 秘密の値と、NEXT_PUBLIC_ の名前。
for (const file of [...staticFiles, ...servedFiles]) {
  const content = readFileSync(file, 'utf8');
  for (const needle of needles) {
    if (content.includes(needle.text)) fail(`${needle.label}が含まれる`, relative(file));
  }
  if (/NEXT_PUBLIC_[A-Z0-9_]+/.test(content)) {
    fail('NEXT_PUBLIC_ で始まる環境変数名が含まれる', relative(file));
  }
}

// 3: インラインのイベント属性。script の中身と、引用符の中の値は見ない（題名などの文字）。
for (const file of htmlFiles) {
  const html = readFileSync(file, 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
  const tags = html.match(/<[a-zA-Z][^<>]*>/g) ?? [];
  const withEvent = tags.some((tag) =>
    /\son[a-z]+\s*=/i.test(tag.replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''")),
  );
  if (withEvent) fail('インラインのイベント属性がある', relative(file));
}

// 4: どの HTML も同じ時点のデータ（基準日と更新時刻が 1 種類）。
const statuses = new Map();
for (const file of htmlFiles) {
  const name = path.relative(APP_DIR, file).replaceAll('\\', '/');
  const match = DATA_STATUS.exec(readFileSync(file, 'utf8'));
  if (match === null) {
    if (!NO_LAYOUT.includes(name)) fail('DataStatus の文がない', relative(file));
    continue;
  }
  statuses.set(match[0], [...(statuses.get(match[0]) ?? []), relative(file)]);
}
if (statuses.size > 1) {
  // 古いデータが混ざっている（.next/cache/fetch-cache に前のビルドの応答が残っている、など）。
  const groups = [...statuses.values()].sort((a, b) => a.length - b.length);
  for (const file of groups[0].slice(0, 5)) {
    fail(`基準日や更新時刻が、ほかの HTML と違う（${statuses.size} 種類ある）`, file);
  }
}

// 5: HTML の大きさ（E-17）。
const sizeLines = [];
for (const limit of SIZE_LIMITS) {
  const targets = htmlFiles.filter((file) =>
    limit.match(path.relative(APP_DIR, file).replaceAll('\\', '/')),
  );
  if (targets.length === 0) {
    fail(`${limit.name} の HTML がない`, '.next/server/app');
    continue;
  }
  const sized = targets.map((file) => ({
    file,
    bytes: gzipSync(readFileSync(file)).length,
    raw: statSync(file).size,
  }));
  const largest = sized.reduce((a, b) => (b.bytes > a.bytes ? b : a));
  sizeLines.push(
    `  ${limit.name}: gzip 後 最大 ${(largest.bytes / KB).toFixed(1)} KB（未圧縮 ${(largest.raw / KB).toFixed(1)} KB。${relative(largest.file)}、${targets.length} 個）/ 目安 ${limit.limitKb} KB`,
  );
  // 超えたファイルは、数と、いちばん大きいものだけを出す。
  const over = sized.filter((item) => item.bytes > limit.limitKb * KB);
  if (over.length > 0) {
    fail(
      `${limit.name} の HTML が gzip 後で目安（${limit.limitKb} KB）を超えている（${targets.length} 個のうち ${over.length} 個。最大 ${(largest.bytes / KB).toFixed(1)} KB）`,
      relative(largest.file),
    );
  }
}

process.stdout.write(
  `check-build-output: .next/static ${staticFiles.length} 個、HTML・RSC ${servedFiles.length} 個（うち HTML ${htmlFiles.length} 個）を検査\n`,
);
process.stdout.write(`HTML の大きさ（gzip 後）:\n${sizeLines.join('\n')}\n`);

if (failures.length > 0) {
  process.stderr.write(`ビルド出力の検査に失敗（${failures.length} 件）:\n`);
  for (const failure of failures) {
    process.stderr.write(`  ${failure.file}: ${failure.check}\n`);
  }
  process.exit(1);
}
process.stdout.write(
  'ビルド出力の検査に合格（秘密の値、NEXT_PUBLIC_、イベント属性、データの時点、大きさ）\n',
);
