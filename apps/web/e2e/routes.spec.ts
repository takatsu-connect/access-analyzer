import { expect, test } from '@playwright/test';

import { dictionary, t } from '../src/lib/ui-text';

import { SCREENS, bodyText, mainText } from './support/screens';

/**
 * 画面の存在、404、共通の説明文、外部リンク（07 §6 の E-03、E-05、E-14、E-16）。
 */

// 404 になるべきパス（E-03）。存在しない ID、存在しない slug、不正な形式。
const NOT_FOUND_PATHS = [
  '/no-such-page',
  '/articles/999999',
  '/articles/abc',
  '/articles/101abc',
  '/articles/-1',
  '/authors/no-such-author',
  '/authors/A%20B',
  '/tags/999999',
  '/tags/abc',
  '/categories/11',
  '/reactions',
];

// エラー応答に出てはいけないもの（NFR-91）。スタックトレース、内部の URL、SQL。
const LEAK_PATTERNS: [string, RegExp][] = [
  [
    'スタックトレース',
    /\bat\s+[\w$.<>]+\s+\(|node_modules|\.tsx?:\d+|webpack-internal|turbopack:\/\//,
  ],
  ['内部の URL', /supabase|127\.0\.0\.1:54\d\d\d|localhost:54\d\d\d|postgres(ql)?:\/\//i],
  ['SQL', /\bselect\s+.+\s+from\b|\bpub_[a-z_]+\b|PGRST\d+/i],
];

test.describe('画面の存在、404、共通の説明文、外部リンク（E-03、E-05、E-14、E-16）', () => {
  test('E-05: S-01〜S-08 が 200 で開き、h1 が 05 §1 の問いの文言', async ({ page }) => {
    test.setTimeout(120_000);
    for (const screen of SCREENS.filter((item) => item.status === 200)) {
      const response = await page.goto(screen.path);
      expect.soft(response?.status(), `${screen.id} の状態コード`).toBe(200);
      const h1 = page.locator('h1');
      await expect.soft(h1, `${screen.id} の h1 の数`).toHaveCount(1);
      await expect.soft(h1.first(), `${screen.id} の h1`).toHaveText(screen.h1);
    }
  });

  test('E-05: ナビゲーションが 6 項目で、順位表・設定・ログイン・反応の項目がない', async ({
    page,
  }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: t('nav.aria'), exact: true });
    const labels = (await nav.getByRole('link').allInnerTexts()).map((label) => label.trim());
    expect(labels).toEqual([
      t('nav.dashboard'),
      t('nav.articles'),
      t('nav.authors'),
      t('nav.categories'),
      t('nav.tags'),
      t('nav.activity'),
    ]);
  });

  test('E-03: 存在しない記事 ID、slug、不正な形式が、同じ 404 と同じ本文になる', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    // 本文（main と、その後ろの CommonNotes）と、ページ全体の文字。
    const contents: string[] = [];
    const wholeByPrefix = new Map<string, { path: string; text: string }>();
    for (const path of NOT_FOUND_PATHS) {
      const response = await page.goto(path);
      expect.soft(response?.status(), `${path} の状態コード`).toBe(404);
      await expect.soft(page.locator('h1'), `${path} の h1`).toHaveText(t('notFound.h1'));
      // 共通の説明文（CommonNotes）を含む。
      await expect
        .soft(
          page.getByRole('heading', { name: t('notes.h2'), exact: true }),
          `${path} の CommonNotes`,
        )
        .toHaveCount(1);
      const whole = await bodyText(page);
      const start = whole.indexOf(t('notFound.h1'));
      expect.soft(start, `${path} の本文の位置`).toBeGreaterThan(-1);
      contents.push(whole.slice(start));

      // ヘッダは、パスの先頭（/articles など）でサブナビの有無が変わる。同じ先頭どうしでは、
      // ページ全体の文字が同じ（存在しない ID と不正な形式を、応答から見分けられない）。
      const prefix = path.split('/')[1] ?? '';
      const first = wholeByPrefix.get(prefix);
      if (first === undefined) wholeByPrefix.set(prefix, { path, text: whole });
      else expect.soft(whole, `${path} と ${first.path} のページ全体`).toBe(first.text);
    }
    // どのパスでも本文が同じ。
    for (const [index, content] of contents.entries()) {
      expect.soft(content, `${NOT_FOUND_PATHS[index] ?? ''} の本文`).toBe(contents[0]);
    }
    // 入力したパスを本文に写していない。
    expect.soft(contents[0]).not.toContain('999999');
  });

  test('E-03: 404 の応答に、スタックトレース、内部 URL、SQL がない', async ({ request }) => {
    for (const path of NOT_FOUND_PATHS) {
      const response = await request.get(path);
      expect.soft(response.status(), `${path} の状態コード`).toBe(404);
      const html = await response.text();
      for (const [name, pattern] of LEAK_PATTERNS) {
        expect.soft(pattern.test(html), `${path} の応答に ${name} がない`).toBe(false);
      }
    }
  });

  test('E-14: 全画面（404 を含む）に CommonNotes と DataStatus が 1 つずつあり、main の外にある', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    // DataStatus の文の、日付を差し込んだあとに続く部分。
    const statusTail = dictionary['status.asOf'].split(/\{[A-Za-z]+\}/).at(-1) ?? '';
    expect(statusTail.length).toBeGreaterThan(0);

    for (const screen of SCREENS) {
      await page.goto(screen.path);
      const main = page.locator('main');
      const notes = page.getByRole('heading', { name: t('notes.h2'), exact: true });
      await expect.soft(main, `${screen.id} の main`).toHaveCount(1);
      await expect.soft(notes, `${screen.id} の CommonNotes`).toHaveCount(1);
      await expect.soft(page.getByText(statusTail), `${screen.id} の DataStatus`).toHaveCount(1);
      await expect
        .soft(main.getByRole('heading', { name: t('notes.h2'), exact: true }))
        .toHaveCount(0);
      // 説明文の中身（数え方、伏せ値、比率、出どころ）が、開かなくても読める。
      const body = await bodyText(page);
      for (const key of [
        'notes.pageviews',
        'notes.masked',
        'notes.ratio',
        'notes.source',
      ] as const) {
        expect.soft(body, `${screen.id} の ${key}`).toContain(t(key));
      }
    }
  });

  test('E-14: 全画面の DataStatus が同じ文（どのページも同じ時点のデータ）で、遅れの表示がない', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const statusTail = dictionary['status.asOf'].split(/\{[A-Za-z]+\}/).at(-1) ?? '';
    const delayedHead = dictionary['status.delayed'].split('{')[0] ?? '';
    const seen = new Map<string, string[]>();
    for (const screen of SCREENS) {
      await page.goto(screen.path);
      const status = (await page.getByText(statusTail).first().innerText()).trim();
      seen.set(status, [...(seen.get(status) ?? []), screen.id]);
      // フィクスチャは読み込んだ日のうちにビルドする（日をまたぐと pub_meta.is_stale が true になる）。
      await expect
        .soft(page.getByText(delayedHead), `${screen.id} に遅れの表示がない`)
        .toHaveCount(0);
    }
    // ページによって基準日や更新時刻が違えば、ビルドに古いデータが混ざっている。
    expect([...seen.entries()], 'DataStatus の文の種類').toHaveLength(1);
  });

  test('E-16: 全画面の外部リンクが https://takatsu-connect.com/ 配下だけ', async ({ page }) => {
    test.setTimeout(120_000);
    let externalCount = 0;
    for (const screen of SCREENS) {
      await page.goto(screen.path);
      const hrefs = await page
        .locator('a[href]')
        .evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute('href') ?? ''));
      for (const href of hrefs) {
        // サイト内は / で始まるパス（//host の形ではない）か、ページ内の # だけ。
        const internal = /^\/(?!\/)/.test(href) || href.startsWith('#');
        if (internal) continue;
        externalCount += 1;
        expect
          .soft(
            href.startsWith('https://takatsu-connect.com/'),
            `${screen.id} の外部リンク ${href}`,
          )
          .toBe(true);
      }
      // 新しいタブで開くリンクは、開いた先から元のページを触れない。
      const unsafeBlank = await page
        .locator('a[target="_blank"]')
        .evaluateAll(
          (anchors) =>
            anchors.filter((anchor) => !(anchor.getAttribute('rel') ?? '').includes('noopener'))
              .length,
        );
      expect.soft(unsafeBlank, `${screen.id} の rel のない target=_blank`).toBe(0);
    }
    // 記事と著者のページに、外部リンクが実際にある（0 件で通っていない）。
    expect(externalCount).toBeGreaterThan(0);
  });

  test('E-16: 404 の本文は固定文で、main の文字が辞書どおり', async ({ page }) => {
    await page.goto('/no-such-page');
    const text = await mainText(page);
    for (const key of [
      'notFound.h1',
      'notFound.lead',
      'notFound.reasons.lead',
      'notFound.reason.notYet',
      'notFound.reason.removed',
      'notFound.reason.url',
      'notFound.link.dashboard',
      'notFound.link.search',
      'notFound.link.authors',
    ] as const) {
      expect.soft(text, key).toContain(t(key));
    }
  });
});
