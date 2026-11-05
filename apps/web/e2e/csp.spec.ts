import { writeFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

import { dictionary, t } from '../src/lib/ui-text';

/**
 * CSP の検証（D-17、07 §6 E-01）。
 *
 * `pnpm build` 済みの画面を開き、次を記録する。
 * - ブラウザが報告した CSP 違反（件数と種類）
 * - Client Component のクリックが効くか（ハイドレーションが成功しているか）
 * - HTML に含まれるインラインの script タグ、style タグ、style 属性の数
 * 記録は test-results の csp-report.json に残す。
 *
 * ここは S-01（全体ダッシュボード）1 画面での詳しい記録。全画面の検査は次にある。
 * - headers.spec.ts: CSP の指示の集合が next.config.ts の定義と完全に一致すること（E-01）
 * - inline-script.spec.ts: インラインの script の形、イベント属性、値の描き方（ADR 0010）
 */

type Violation = { directive: string; blockedUri: string; sourceFile: string; line: number };
type ProbeWindow = Window & { __cspViolations?: Violation[] };

// 06 §6 のヘッダ。Content-Security-Policy は下で指示子ごとに確かめる。
const EXPECTED_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'x-robots-tag': 'noindex, nofollow',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

// script-src 以外の指示子（06 §6）。
const EXPECTED_DIRECTIVES = [
  "default-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'none'",
];

function scriptTags(html: string): string[] {
  return html.match(/<script\b[^>]*>/gi) ?? [];
}

test('CSP の下で全体ダッシュボード（S-01）が動き、スタイルが当たる（E-01）', async ({
  page,
  request,
}, testInfo) => {
  const consoleMessages: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) consoleMessages.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  // ページのスクリプトより先に、違反の通知を集める。
  await page.addInitScript(() => {
    const probe = window as ProbeWindow;
    probe.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      probe.__cspViolations?.push({
        directive: event.effectiveDirective,
        blockedUri: event.blockedURI,
        sourceFile: event.sourceFile,
        line: event.lineNumber,
      });
    });
  });

  const response = await page.goto('/', { waitUntil: 'networkidle' });
  const headers = response?.headers() ?? {};
  const csp = headers['content-security-policy'] ?? '';
  const directives = csp.split(';').map((directive) => directive.trim());

  // 配信された HTML そのもの（ハイドレーション前）を数える。
  const html = await (await request.get('/')).text();
  const tags = scriptTags(html);
  const inlineScriptCount = tags.filter((tag) => !/\ssrc\s*=/i.test(tag)).length;
  const externalScriptCount = tags.length - inlineScriptCount;
  const integrityScriptCount = tags.filter((tag) => /\sintegrity\s*=/i.test(tag)).length;
  const styleTagCount = (html.match(/<style\b/gi) ?? []).length;
  const styleAttributeCount = (html.match(/<[a-z][^>]*\sstyle\s*=/gi) ?? []).length;

  // スタイルが当たっているか（globals.css のトークンと CSS Modules）。
  // S-01 の PeriodPicker の「直近 7 日」のボタンで確かめる。
  const button = page.getByRole('button', { name: t('period.last7') });
  const computed = await button.evaluate((element) => {
    const buttonStyle = getComputedStyle(element);
    return {
      paddingTop: buttonStyle.paddingTop,
      borderTopStyle: buttonStyle.borderTopStyle,
      borderTopWidth: buttonStyle.borderTopWidth,
      bodyMargin: getComputedStyle(document.body).marginTop,
      shade5: getComputedStyle(document.documentElement).getPropertyValue('--shade-5').trim(),
    };
  });
  const stylesApplied =
    // PeriodPicker のボタンの上下の余白は --space-1（4px）。
    computed.paddingTop === '4px' &&
    computed.borderTopStyle === 'solid' &&
    computed.borderTopWidth === '1px' &&
    computed.bodyMargin === '0px' &&
    computed.shade5 !== '';

  // クリックが効くか（押すと aria-pressed が true になる）。
  const pressedBefore = await button.getAttribute('aria-pressed');
  await button.click();
  let clickWorked = true;
  try {
    await expect(button).toHaveAttribute('aria-pressed', 'true', { timeout: 5_000 });
  } catch {
    clickWorked = false;
  }

  const dom = await page.evaluate(() => ({
    violations: (window as ProbeWindow).__cspViolations ?? [],
    styleAttributes: document.querySelectorAll('[style]').length,
    styledElements: [...document.querySelectorAll('[style]')].map(
      (element) => `${element.tagName.toLowerCase()}[style="${element.getAttribute('style')}"]`,
    ),
    styleTags: document.querySelectorAll('style').length,
  }));

  const report = {
    scriptSrc: directives.find((directive) => directive.startsWith('script-src')) ?? null,
    csp,
    violationCount: dom.violations.length,
    violations: dom.violations,
    consoleMessageCount: consoleMessages.length,
    consoleMessages,
    pageErrors,
    pressedBefore,
    clickWorked,
    html: {
      inlineScriptCount,
      externalScriptCount,
      integrityScriptCount,
      styleTagCount,
      styleAttributeCount,
    },
    domAfterHydration: {
      styleAttributes: dom.styleAttributes,
      styledElements: dom.styledElements,
      styleTags: dom.styleTags,
    },
    computed,
    stylesApplied,
  };
  const body = JSON.stringify(report, null, 2);
  await writeFile(testInfo.outputPath('csp-report.json'), body, 'utf8');
  await testInfo.attach('csp-report', { body, contentType: 'application/json' });

  // 06 §6 のヘッダ。
  for (const [name, value] of Object.entries(EXPECTED_HEADERS)) {
    expect.soft(headers[name], name).toBe(value);
  }
  for (const directive of EXPECTED_DIRECTIVES) {
    expect.soft(directives, directive).toContain(directive);
  }
  expect.soft(headers['x-powered-by'], 'x-powered-by').toBeUndefined();

  // style-src 'self' のままで、インラインのスタイルに頼っていない。
  expect.soft(styleTagCount, 'HTML の style タグ').toBe(0);
  expect.soft(styleAttributeCount, 'HTML の style 属性').toBe(0);
  expect.soft(stylesApplied, 'スタイルが当たっている').toBe(true);

  // CSP に止められたものがなく、ハイドレーションが成功している。
  expect.soft(dom.violations, 'CSP 違反').toEqual([]);
  expect.soft(consoleMessages, 'コンソールの CSP の通知').toEqual([]);
  expect.soft(pageErrors, 'ページのエラー').toEqual([]);
  expect.soft(pressedBefore, 'クリック前の aria-pressed').toBe('false');
  expect.soft(clickWorked, 'クリックで aria-pressed が true になる').toBe(true);
});

test('一覧にないパスは 404 の固定文で、同じヘッダが付く（E-01）', async ({ request }) => {
  const response = await request.get('/no-such-page');
  expect(response.status()).toBe(404);

  const headers = response.headers();
  for (const [name, value] of Object.entries(EXPECTED_HEADERS)) {
    expect.soft(headers[name], name).toBe(value);
  }
  const directives = (headers['content-security-policy'] ?? '')
    .split(';')
    .map((directive) => directive.trim());
  for (const directive of EXPECTED_DIRECTIVES) {
    expect.soft(directives, directive).toContain(directive);
  }

  expect.soft(await response.text()).toContain(t('notFound.h1'));
});

test('更新の状況と共通の説明文は、レイアウトが全ページに 1 つずつ出す（404 を含む）', async ({
  page,
}) => {
  // DataStatus の文の、日付を差し込んだあとに続く部分。
  const statusTail = dictionary['status.asOf'].split(/\{[A-Za-z]+\}/).at(-1) ?? '';
  expect(statusTail.length).toBeGreaterThan(0);

  for (const url of ['/', '/no-such-page']) {
    await page.goto(url);
    const main = page.locator('main');
    const notes = page.getByRole('heading', { name: t('notes.h2') });
    const status = page.getByText(statusTail);

    // main は 1 つ（ページが main を重ねていない）。
    await expect.soft(main, `${url} の main`).toHaveCount(1);
    // どちらも 1 つずつあり、main の外（前と後）にある。
    await expect.soft(notes, `${url} の CommonNotes`).toHaveCount(1);
    await expect.soft(status, `${url} の DataStatus`).toHaveCount(1);
    await expect.soft(main.getByRole('heading', { name: t('notes.h2') })).toHaveCount(0);
    await expect.soft(main.getByText(statusTail)).toHaveCount(0);

    // 上から、DataStatus、main、CommonNotes の順。
    const statusBox = await status.boundingBox();
    const mainBox = await main.boundingBox();
    const notesBox = await notes.boundingBox();
    const mainTop = mainBox?.y ?? Number.NaN;
    const mainBottom = mainTop + (mainBox?.height ?? Number.NaN);
    expect.soft(statusBox?.y, `${url} の DataStatus は main の前`).toBeLessThan(mainTop);
    expect
      .soft(notesBox?.y, `${url} の CommonNotes は main の後`)
      .toBeGreaterThanOrEqual(mainBottom);
  }
});

test('robots.txt と meta robots が noindex（E-02）', async ({ page, request }) => {
  const robots = await (await request.get('/robots.txt')).text();
  expect(robots).toMatch(/Disallow:\s*\/\s*$/m);

  await page.goto('/');
  const content = await page.locator('meta[name="robots"]').getAttribute('content');
  expect(content).toContain('noindex');
  expect(content).toContain('nofollow');
});
