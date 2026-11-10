import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { t } from '../src/lib/ui-text';

/**
 * イベント記事のタブ（S-10a〜S-10e）と、カテゴリの親子の表示（2026-11-10 の依頼者の決定）。
 *
 * 前提のフィクスチャ（apps/batch/tests/support/e2e_fixture.py。親の ID は contracts の
 * ARTICLE_CATEGORY_ID = 10、EVENT_CATEGORY_ID = 9 に合わせてあること）:
 * - 記事 101 は「記事 > まちの話題」（11）だけ。記事 112 は「イベント」の親に直接付いている。
 * - 「イベント > 季節の催し」（21）、「記事 > まちの話題」（11）がある。
 * - 記事 105 は「マップ」だけ（どちらのタブにも出ない）。
 */

const EVENT_TABS: [string, string][] = [
  [t('s10a.tab'), '/events/top'],
  [t('s10b.tab'), '/events/new'],
  [t('s10c.tab'), '/events/long'],
  [t('s10d.tab'), '/events/recent'],
  [t('s10e.tab'), '/events'],
];

/** 表の記事のリンク先（/articles/<id>）から記事の ID を集める。 */
async function listedPostIds(page: Page): Promise<number[]> {
  const hrefs = await page
    .locator('main table a[href^="/articles/"]')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
  return [...new Set(hrefs.map((href) => Number(href.split('/')[2])))].sort((a, b) => a - b);
}

test.describe('イベント記事のタブ（S-10a〜S-10e）', () => {
  test('ヘッダに「イベント記事」があり、中ではイベント記事のサブナビを出す', async ({ page }) => {
    await page.goto('/events/long');
    const main = page.getByRole('navigation', { name: t('nav.aria') });
    await expect(main.getByRole('link', { name: t('nav.events'), exact: true })).toHaveAttribute(
      'aria-current',
      'true',
    );
    const sub = page.getByRole('navigation', { name: t('nav.events.aria') });
    const links = sub.getByRole('link');
    await expect(links).toHaveCount(EVENT_TABS.length);
    for (const [index, [name, href]] of EVENT_TABS.entries()) {
      await expect(links.nth(index)).toHaveText(name);
      await expect(links.nth(index)).toHaveAttribute('href', href);
    }
    await expect(sub.getByRole('link', { name: t('s10c.tab') })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(
      page.getByRole('navigation', { name: t('nav.articles.aria'), exact: true }),
    ).toHaveCount(0);
  });

  test('探す（/events）: カテゴリの選択肢はイベントの親とその子だけ', async ({ page }) => {
    await page.goto('/events');
    const options = await page
      .getByLabel(t('s02e.filter.category'))
      .locator('option')
      .allTextContents();
    expect(options[0]).toBe(t('s02e.filter.all'));
    expect(options.slice(1).length).toBeGreaterThan(0);
    for (const option of options.slice(1)) expect(option).toMatch(/^イベント( > .+)?$/);
  });

  test('探す: イベントだけの記事はイベント記事に出て記事に出ない。記事だけの記事はその逆', async ({
    page,
  }) => {
    await page.goto('/events');
    const events = await listedPostIds(page);
    expect(events).toContain(112);
    expect(events).not.toContain(101);
    expect(events).not.toContain(105);

    await page.goto('/articles');
    const articles = await listedPostIds(page);
    expect(articles).toContain(101);
    expect(articles).not.toContain(112);
    expect(articles).not.toContain(105);
  });

  test('探す: 記事の子カテゴリの cat は、イベント記事では無視する（絞り込みなしと同じ）', async ({
    page,
  }) => {
    await page.goto('/events');
    const all = await listedPostIds(page);
    await page.goto('/events?cat=11');
    await expect(page.getByLabel(t('s02e.filter.category'))).toHaveValue('');
    expect(await listedPostIds(page)).toEqual(all);
  });

  test('一覧から開く記事詳細は /articles/[postId] を共有し、/events/[id] はない', async ({
    page,
  }) => {
    await page.goto('/events');
    const first = page.locator('main table a[href^="/articles/"]').first();
    await expect(first).toBeVisible();
    const response = await page.goto('/events/112');
    expect(response?.status()).toBe(404);
  });
});

test.describe('カテゴリの親子（S-06、S-06b）', () => {
  test('S-06: 子カテゴリのリンクは、親の種類の「探す」へ', async ({ page }) => {
    await page.goto('/categories?p=last90');
    const hrefs = await page
      .locator('main a[href*="?cat="]')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
    expect(hrefs).toContain('/articles?cat=11');
    expect(hrefs).toContain('/events?cat=21');
    for (const href of hrefs) expect(href).toMatch(/^\/(articles|events)\?cat=[1-9][0-9]*$/);
  });

  test('S-06b 子カテゴリ: 図は親の名前の見出しごとに分かれる（広い画面と狭い画面）', async ({
    page,
  }) => {
    for (const width of [1280, 360]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/categories/seasonal?axis=child');
      const view = page.locator(`[data-view="${width === 360 ? 'narrow' : 'wide'}"]`);
      // 軸は URL から読んで描き直すので、見出しが出るのを待ってから数える。
      await expect(view.locator('section[data-group] > h2').first()).toBeVisible();
      const headings = await view.locator('section[data-group] > h2').allTextContents();
      expect(headings, `${width}px の見出し`).toEqual(expect.arrayContaining(['イベント', '記事']));
      // 見出しは画面に見えている（横に送る枠の外）。
      for (const heading of await view.locator('section[data-group] > h2').all()) {
        await expect(heading).toBeVisible();
      }
    }
  });

  test('S-06b 子カテゴリ: 同じ値の表に親の名前の行がある', async ({ page }) => {
    await page.goto('/categories/seasonal?axis=child');
    await page.getByText(t('s06b.table.summary')).click();
    const parents = await page
      .locator('table thead tr[data-row="parents"] th[scope="colgroup"]')
      .allTextContents();
    expect(parents).toEqual(expect.arrayContaining(['イベント', '記事']));
  });
});

test.describe('デザインレビュー 2026-11-10 の指摘（H-1、H-2、M-1〜M-4）', () => {
  test('H-2: イベントだけの記事の詳細は、ヘッダの現在地が「イベント記事」。両方に属する記事は「記事」', async ({
    page,
  }) => {
    const main = page.getByRole('navigation', { name: t('nav.aria') });
    await page.goto('/articles/112');
    await expect(main.getByRole('link', { name: t('nav.events'), exact: true })).toHaveAttribute(
      'aria-current',
      'true',
    );
    await expect(
      main.getByRole('link', { name: t('nav.articles'), exact: true }),
    ).not.toHaveAttribute('aria-current');
    const sub = page.getByRole('navigation', { name: t('nav.events.aria') });
    await expect(sub.getByRole('link')).toHaveCount(5);
    await expect(sub.locator('[aria-current]')).toHaveCount(0);

    await page.goto('/articles/109');
    await expect(main.getByRole('link', { name: t('nav.articles'), exact: true })).toHaveAttribute(
      'aria-current',
      'true',
    );
    await expect(page.getByRole('navigation', { name: t('nav.articles.aria') })).toBeVisible();
  });

  test('H-2: 一覧にない記事の 404 では、ヘッダに区分の印もサブナビもない', async ({ page }) => {
    const response = await page.goto('/articles/999999');
    expect(response?.status()).toBe(404);
    const main = page.getByRole('navigation', { name: t('nav.aria') });
    await expect(main.locator('[aria-current]')).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: t('nav.events.aria') })).toHaveCount(0);
  });

  test('M-3: S-06 と S-06b の親の並びは 記事、イベント、マップ、広告', async ({ page }) => {
    const ORDER = ['記事', 'イベント', 'マップ', '広告'];
    await page.goto('/categories?p=last90');
    const headings = await page.locator('main section h2').allTextContents();
    expect(headings.filter((text) => ORDER.includes(text))).toEqual(ORDER);

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/categories/seasonal');
    const rows = page.locator('[data-view="wide"] div[aria-hidden="true"] > span');
    await expect(rows.first()).toBeVisible();
    expect(await rows.allTextContents()).toEqual(ORDER);
  });

  test('H-1: 子カテゴリの図は、親をまたいで月の列の位置と幅がそろう（1280px）', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/categories/seasonal?axis=child');
    const groups = page.locator('[data-view="wide"] section[data-group]');
    await expect(groups.first().locator('h2')).toBeVisible();
    const boxes = [];
    for (const group of await groups.all()) {
      const cell = group.locator('[data-part="cell"][data-row="0"][data-col="0"]');
      boxes.push(await cell.boundingBox());
    }
    expect(boxes.length).toBeGreaterThan(1);
    for (const box of boxes) {
      expect(box?.x).toBeCloseTo(boxes[0]?.x ?? -1, 0);
      expect(box?.width).toBeCloseTo(boxes[0]?.width ?? -1, 0);
    }
  });

  test('H-1: 360px でも、子カテゴリの図のマスは 44px 以上で、全親で同じ幅', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto('/categories/seasonal?axis=child');
    const groups = page.locator('[data-view="narrow"] section[data-group]');
    await expect(groups.first().locator('h2')).toBeVisible();
    const widths = [];
    for (const group of await groups.all()) {
      const box = await group.locator('[data-part="cell"]').first().boundingBox();
      widths.push(box?.width ?? 0);
    }
    for (const width of widths) {
      expect(width).toBeGreaterThanOrEqual(43.5);
      expect(width).toBeCloseTo(widths[0] ?? -1, 0);
    }
    // ページ全体は横にはみ出さない（横に送るのは親ごとの枠の中だけ）。
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('M-1: 案内と凡例は全親の上に 1 回だけ。最初から文を出す固定行は最初の親だけ', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/categories/seasonal?axis=child');
    const wide = page.locator('[data-view="wide"]');
    await expect(wide.locator('section[data-group]').first()).toBeVisible();
    await expect(wide.getByText(t('s06b.tap.hint'), { exact: true })).toHaveCount(1);
    await expect(wide.locator('[data-part="heatmap-notes"]')).toHaveCount(1);
    const rows = await wide
      .locator('section[data-group] [data-part="fixed-row"]')
      .allTextContents();
    expect(rows[0]?.length ?? 0).toBeGreaterThan(0);
    expect(rows.slice(1).every((text) => text === '')).toBe(true);
  });

  test('M-2: 親の見出しは共通の h2 と同じ大きさ（S-06 の親の見出しと同じ）', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/categories?p=last90');
    const reference = await page
      .locator('main section h2')
      .first()
      .evaluate((element) => getComputedStyle(element).fontSize);
    await page.goto('/categories/seasonal?axis=child');
    const heading = page.locator('[data-view="wide"] section[data-group] > h2').first();
    await expect(heading).toBeVisible();
    expect(await heading.evaluate((element) => getComputedStyle(element).fontSize)).toBe(reference);
  });

  test('M-4: 記事詳細の比べる相手の一言は、図に帯を描くときだけ出し、図（凡例）の直後に置く', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const ids = [...Array(12).keys()].map((index) => 101 + index);
    let withBand = 0;
    for (const id of ids) {
      const response = await page.goto(`/articles/${id}`);
      expect(response?.status()).toBe(200);
      const section = page.locator('section[aria-labelledby="s03-curve"]');
      // 数え始める前に公開した記事には、この節がない。
      if ((await section.count()) === 0) continue;
      const band = await section.locator('path[data-series="band"]').count();
      const scope = section.getByText(/^比べる相手は、/);
      await expect.soft(scope, `記事 ${id} の一言`).toHaveCount(band > 0 ? 1 : 0);
      if (band === 0) continue;
      withBand += 1;
      // 図（凡例を含む）の次の要素が一言。
      const next = await section
        .locator('path[data-series="band"]')
        .evaluate(
          (path) =>
            path.closest('svg')?.parentElement?.closest('div')?.nextElementSibling?.textContent ??
            '',
        );
      expect.soft(next, `記事 ${id} の一言の位置`).toMatch(/^比べる相手は、/);
    }
    expect(withBand).toBeGreaterThan(0);
  });
});
