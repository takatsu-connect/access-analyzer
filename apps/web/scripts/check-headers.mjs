// 応答ヘッダの検査（07 §7 の S-11。E-01 と同じ値。NFR-91、ADR 0010 の 4）。
//
// `pnpm run build` のあとに単独で流す:  pnpm run check:headers
//
// `next start` を別のポート（既定 3101。CHECK_HEADERS_PORT で変えられる）で立て、ビルドで生成された
// 全ルート（.next/prerender-manifest.json）と 404 に対して、応答ヘッダを確かめる。
// Playwright が動かなくても、ヘッダの欠けが分かるようにするための二重の検査。
// 接続するのは 127.0.0.1 だけ。失敗は終了コード 1、準備が足りないときは 2。
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = path.join(WEB_ROOT, '.next', 'prerender-manifest.json');
const NEXT_BIN = path.join(WEB_ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
const PORT = Number(process.env.CHECK_HEADERS_PORT ?? 3101);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const START_TIMEOUT_MS = 60_000;

// CSP の指示の集合（ADR 0010 の 4）。next.config.ts の定義と同じでなければならない。
// 足りない指示も、余分な指示も失敗にする。
const EXPECTED_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "script-src-attr 'none'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'none'",
];
// CSP 以外のヘッダ（06 §6）。
const EXPECTED_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'x-robots-tag': 'noindex, nofollow',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};
// 存在しないパス（404 でも同じヘッダが付く）。
const NOT_FOUND_PATHS = ['/no-such-page', '/articles/999999', '/articles/abc', '/authors/A%20B'];

function notReady(message) {
  process.stderr.write(`check-headers: ${message}\n`);
  process.exit(2);
}

function parseCsp(value) {
  return (value ?? '')
    .split(';')
    .map((directive) => directive.trim().replace(/\s+/g, ' '))
    .filter((directive) => directive !== '')
    .sort();
}

async function waitUntilReady(server) {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) return false;
    try {
      const response = await fetch(`${ORIGIN}/robots.txt`, { redirect: 'manual' });
      await response.arrayBuffer();
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  return false;
}

/** 1 つのパスのヘッダを確かめ、食い違いの説明を返す。 */
async function checkPath(pathname, expectedStatus) {
  const problems = [];
  const response = await fetch(`${ORIGIN}${pathname}`, { redirect: 'manual' });
  await response.arrayBuffer();
  if (response.status !== expectedStatus) {
    problems.push(`状態コードが ${response.status}（期待は ${expectedStatus}）`);
  }
  const actual = parseCsp(response.headers.get('content-security-policy'));
  const expected = [...EXPECTED_CSP].sort();
  const missing = expected.filter((directive) => !actual.includes(directive));
  const extra = actual.filter((directive) => !expected.includes(directive));
  if (actual.length === 0) problems.push('Content-Security-Policy がない');
  for (const directive of missing) problems.push(`CSP に「${directive}」がない`);
  for (const directive of extra) problems.push(`CSP に余分な「${directive}」がある`);
  for (const [name, value] of Object.entries(EXPECTED_HEADERS)) {
    const got = response.headers.get(name);
    if (got !== value) problems.push(`${name} が「${got ?? '（なし）'}」（期待は「${value}」）`);
  }
  if (response.headers.get('x-powered-by') !== null) problems.push('x-powered-by が付いている');
  return problems;
}

if (!existsSync(MANIFEST)) notReady('.next がない。先に pnpm run build を実行する。');
if (!existsSync(NEXT_BIN)) notReady('next が入っていない。pnpm install を実行する。');

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const routes = Object.keys(manifest.routes ?? {}).sort();
if (routes.length === 0) notReady('prerender-manifest.json にルートがない。');

// シェルを通さずに起動する（終わったら確実に止めるため）。
const server = spawn(
  process.execPath,
  [NEXT_BIN, 'start', '--hostname', '127.0.0.1', '--port', String(PORT)],
  { cwd: WEB_ROOT, stdio: ['ignore', 'ignore', 'inherit'] },
);

let exitCode = 0;
try {
  if (!(await waitUntilReady(server))) {
    process.stderr.write(
      `check-headers: next start が ${ORIGIN} で立ち上がらない（ポートが使用中か）。\n`,
    );
    exitCode = 2;
  } else {
    const failures = [];
    const targets = [
      // /_not-found と /_global-error は、ビルドが内部で使うパス。404 は下の存在しないパスで見る。
      ...routes.filter((route) => !route.startsWith('/_')).map((route) => [route, 200]),
      ...NOT_FOUND_PATHS.map((route) => [route, 404]),
    ];
    for (const [pathname, status] of targets) {
      for (const problem of await checkPath(pathname, status))
        failures.push(`${pathname}: ${problem}`);
    }
    process.stdout.write(
      `check-headers: ${targets.length} 個のパス（ルート ${targets.length - NOT_FOUND_PATHS.length}、404 ${NOT_FOUND_PATHS.length}）を検査\n`,
    );
    if (failures.length > 0) {
      process.stderr.write(`応答ヘッダの検査に失敗（${failures.length} 件）:\n`);
      for (const failure of failures) process.stderr.write(`  ${failure}\n`);
      exitCode = 1;
    } else {
      process.stdout.write(
        '応答ヘッダの検査に合格（CSP の指示の集合が一致、ほかのヘッダも 06 §6 の値）\n',
      );
    }
  }
} finally {
  server.kill();
}
process.exit(exitCode);
