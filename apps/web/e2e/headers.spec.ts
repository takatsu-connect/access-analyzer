import { expect, test } from '@playwright/test';

import nextConfig from '../next.config';

import {
  EXPECTED_CSP,
  EXPECTED_HEADERS,
  SCREENS,
  openScreen,
  parseCsp,
  watchPage,
} from './support/screens';

/**
 * 応答ヘッダと noindex（07 §6 の E-01、E-02。ADR 0010 の 4 と 5）。
 * 全画面の一覧は support/screens.ts にある。
 */
test.describe('応答ヘッダと noindex（E-01、E-02）', () => {
  test('E-01: next.config.ts の CSP の定義が、ADR 0010 の指示の集合と完全に一致する', async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    expect(rules, 'headers() の規則は 1 つ').toHaveLength(1);
    // すべてのパスに付く。
    expect(rules[0]?.source).toBe('/(.*)');
    const csp = rules[0]?.headers.find((header) => header.key === 'Content-Security-Policy');
    expect(parseCsp(csp?.value)).toEqual([...EXPECTED_CSP].sort());
  });

  test('E-01: 全画面で、CSP の指示の集合が next.config.ts の定義と完全に一致する', async ({
    request,
  }) => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const defined = rules[0]?.headers.find((header) => header.key === 'Content-Security-Policy');
    const expected = parseCsp(defined?.value);
    expect(expected.length).toBeGreaterThan(0);

    for (const screen of SCREENS) {
      const response = await request.get(screen.path);
      expect.soft(response.status(), `${screen.id} の状態コード`).toBe(screen.status);
      // 足りない指示も、余分な指示も失敗にする（集合の一致）。
      const actual = parseCsp(response.headers()['content-security-policy']);
      expect.soft(actual, `${screen.id} の CSP（定義と一致）`).toEqual(expected);
      expect
        .soft(actual, `${screen.id} の CSP（ADR 0010 と一致）`)
        .toEqual([...EXPECTED_CSP].sort());
      // 同じヘッダが 2 つ付いていない（2 つあると、ブラウザは両方を満たすものだけを許す）。
      const count = response
        .headersArray()
        .filter((header) => header.name.toLowerCase() === 'content-security-policy').length;
      expect.soft(count, `${screen.id} の CSP のヘッダの数`).toBe(1);
    }
  });

  test("E-01: 'unsafe-inline' は script-src の 1 か所だけで、緩い値がない", async ({ request }) => {
    const response = await request.get('/');
    const directives = parseCsp(response.headers()['content-security-policy']);
    const withUnsafeInline = directives.filter((directive) =>
      directive.includes("'unsafe-inline'"),
    );
    expect(withUnsafeInline).toEqual(["script-src 'self' 'unsafe-inline'"]);
    const styleSrc = directives.find((directive) => directive.startsWith('style-src'));
    expect(styleSrc).toBe("style-src 'self'");
    for (const directive of directives.filter((item) => item.startsWith('script-src'))) {
      for (const loose of ["'unsafe-eval'", 'data:', 'blob:', 'https:', '*']) {
        expect.soft(directive.split(' '), `${directive} に ${loose} がない`).not.toContain(loose);
      }
    }
  });

  test('E-01: 全画面で、CSP 以外の応答ヘッダが 06 §6 の値で、x-powered-by がない', async ({
    request,
  }) => {
    for (const screen of SCREENS) {
      const headers = (await request.get(screen.path)).headers();
      for (const [name, value] of Object.entries(EXPECTED_HEADERS)) {
        expect.soft(headers[name], `${screen.id} の ${name}`).toBe(value);
      }
      expect.soft(headers['x-powered-by'], `${screen.id} の x-powered-by`).toBeUndefined();
    }
  });

  test('E-01: 全画面で、ブラウザが報告する CSP 違反が 0 件で、ページのエラーがない', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const watch = await watchPage(page);
    for (const screen of SCREENS) {
      await openScreen(page, screen.path);
      expect.soft(await watch.violations(), `${screen.id} の CSP 違反`).toEqual([]);
    }
    expect.soft(watch.consoleCsp, 'コンソールの CSP の通知').toEqual([]);
    expect.soft(watch.pageErrors, 'ページのエラー').toEqual([]);
    expect.soft(watch.dialogs, 'ダイアログ').toEqual([]);
  });

  test('E-01: 全画面の HTML に、style タグと style 属性がない（style-src は self だけ）', async ({
    request,
  }) => {
    for (const screen of SCREENS) {
      const html = await (await request.get(screen.path)).text();
      expect.soft((html.match(/<style\b/gi) ?? []).length, `${screen.id} の style タグ`).toBe(0);
      expect
        .soft((html.match(/<[a-z][^>]*\sstyle\s*=/gi) ?? []).length, `${screen.id} の style 属性`)
        .toBe(0);
    }
  });

  test('E-02: 全画面の meta robots が noindex, nofollow', async ({ page }) => {
    test.setTimeout(120_000);
    for (const screen of SCREENS) {
      await page.goto(screen.path);
      // 404 では Next.js が noindex だけの meta を 1 つ足すので、meta は 2 つになる。
      // どの meta も索引を許さず、合わせて noindex と nofollow の両方がある。
      const contents = await page
        .locator('meta[name="robots"]')
        .evaluateAll((metas) => metas.map((meta) => meta.getAttribute('content') ?? ''));
      expect.soft(contents.length, `${screen.id} の meta robots の数`).toBeGreaterThan(0);
      const values = contents.flatMap((content) => content.split(',').map((value) => value.trim()));
      expect.soft(values, `${screen.id} の noindex`).toContain('noindex');
      expect.soft(values, `${screen.id} の nofollow`).toContain('nofollow');
      for (const content of contents) {
        expect.soft(content, `${screen.id} のどの meta も noindex を含む`).toContain('noindex');
      }
      for (const allowed of ['index', 'follow', 'all']) {
        expect.soft(values, `${screen.id} に ${allowed} がない`).not.toContain(allowed);
      }
    }
  });

  test('E-02: robots.txt が Disallow: /', async ({ request }) => {
    const response = await request.get('/robots.txt');
    expect(response.status()).toBe(200);
    const robots = await response.text();
    expect(robots).toMatch(/^User-agent:\s*\*\s*$/im);
    expect(robots).toMatch(/^Disallow:\s*\/\s*$/m);
    expect(robots).not.toMatch(/^Allow:/im);
  });
});
