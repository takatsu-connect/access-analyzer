import { expect, test, type Page } from '@playwright/test';

import { t } from '../src/lib/ui-text';

import { HORIZONTAL_SCROLL_ALLOWED, SCREENS, openScreen } from './support/screens';

/**
 * スマホ幅（07 §6 の E-13。NFR-81、NFR-99）。viewport は 360 × 740。
 *
 * 記事の表は、狭い画面では題名を 1 段目に置き、残りの列を下に並べる（CSS で行を組み替える）。
 * そのため「見えている列が 4 つ以下」と「横スクロールがない」で確かめる。
 */
test.use({ viewport: { width: 360, height: 740 } });

type Overflow = { scrollWidth: number; clientWidth: number; bodyScrollWidth: number };

function overflow(page: Page): Promise<Overflow> {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));
}

/** 見えている表ごとに、1 行で見えているセルの数の最大値を返す。 */
function visibleColumns(page: Page): Promise<{ caption: string; columns: number; rows: number }[]> {
  return page.locator('main').evaluate((main) => {
    const shown = (element: Element) => element.checkVisibility({ visibilityProperty: true });
    return [...main.querySelectorAll('table')].filter(shown).map((table) => {
      const rows = [...table.querySelectorAll('tr')].filter(shown);
      const counts = rows.map((row) => [...row.children].filter(shown).length);
      return {
        caption: (table.querySelector('caption')?.textContent ?? '').trim(),
        columns: Math.max(0, ...counts),
        rows: rows.length,
      };
    });
  });
}

/** 閉じている details をすべて開く（中の表と図も確かめるため）。 */
async function openAllDetails(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const details of document.querySelectorAll('details')) details.open = true;
  });
}

test.describe('スマホ幅 360 × 740（E-13）', () => {
  test('E-13: S-06b 以外の全画面で、横スクロールが発生しない（details を開いても）', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    for (const screen of SCREENS) {
      if (HORIZONTAL_SCROLL_ALLOWED.includes(screen.id)) continue;
      await openScreen(page, screen.path);
      const closed = await overflow(page);
      expect.soft(closed.clientWidth, `${screen.id} の幅`).toBe(360);
      expect.soft(closed.scrollWidth, `${screen.id} の横スクロール`).toBeLessThanOrEqual(360);
      expect.soft(closed.bodyScrollWidth, `${screen.id} の body の幅`).toBeLessThanOrEqual(360);

      await openAllDetails(page);
      const opened = await overflow(page);
      expect
        .soft(opened.scrollWidth, `${screen.id} の横スクロール（details を開いたとき）`)
        .toBeLessThanOrEqual(360);
    }
  });

  test('E-13: 期間や絞り込みを変えた画面でも、横スクロールが発生しない', async ({ page }) => {
    test.setTimeout(120_000);
    const paths = [
      '/?p=last90',
      '/?p=last7',
      '/articles?author=author-b&sort=pv',
      '/articles/top?p=last90&n=50',
      '/articles/new?p=last90',
      '/authors/author-b?p=last90&sort=pv30',
      '/categories?p=last90',
      '/activity?p=last90',
    ];
    for (const path of paths) {
      await openScreen(page, path);
      await openAllDetails(page);
      const result = await overflow(page);
      expect.soft(result.scrollWidth, `${path} の横スクロール`).toBeLessThanOrEqual(360);
    }
  });

  test('E-13: 各表の見えている列が 4 つ以下（details の中の表も）', async ({ page }) => {
    test.setTimeout(180_000);
    let tableCount = 0;
    for (const screen of SCREENS) {
      if (HORIZONTAL_SCROLL_ALLOWED.includes(screen.id)) continue;
      await openScreen(page, screen.path);
      await openAllDetails(page);
      const tables = await visibleColumns(page);
      tableCount += tables.length;
      for (const table of tables) {
        expect
          .soft(table.columns, `${screen.id} の表「${table.caption}」の見えている列`)
          .toBeLessThanOrEqual(4);
      }
    }
    expect(tableCount).toBeGreaterThan(20);
  });

  test('E-13: 列を隠した記事の表には、行ごとに「詳しく」がある', async ({ page }) => {
    // S-02a などの列が 4 つ以下の表は、隠す列がないので対象にしない。
    for (const path of ['/articles', '/articles/new?p=last90', '/authors/author-b']) {
      await openScreen(page, path);
      const table = page.locator('table[role="table"]').first();
      const counts = await table.evaluate((element) => {
        const shown = (item: Element) => item.checkVisibility({ visibilityProperty: true });
        const articleRows = [...element.querySelectorAll('tbody tr')].filter(
          (row) => row.querySelector('th[role="rowheader"]') !== null,
        );
        const summaries = [...element.querySelectorAll('summary')].filter(shown);
        const hiddenCells = articleRows
          .flatMap((row) => [...row.children])
          .filter((cell) => !shown(cell));
        return {
          articles: articleRows.length,
          summaries: summaries.length,
          hiddenCells: hiddenCells.length,
          labels: [...new Set(summaries.map((summary) => (summary.textContent ?? '').slice(0, 3)))],
        };
      });
      expect.soft(counts.articles, `${path} の記事の行`).toBeGreaterThan(0);
      expect.soft(counts.hiddenCells, `${path} で隠した列がある`).toBeGreaterThan(0);
      // 隠した列の中身は、行ごとの「詳しく」で読める。
      expect.soft(counts.summaries, `${path} の「詳しく」の数`).toBe(counts.articles);
      expect.soft(counts.labels, `${path} の「詳しく」の文言`).toEqual([t('column.more')]);
    }
  });

  test('E-13: ヒートマップの列が 6 つ（4 時間ごと）', async ({ page }) => {
    await openScreen(page, '/');
    // 狭い画面では「読者はどんな人？」が閉じているので、開く。
    await page.locator('summary', { hasText: t('s01.readers.h2') }).click();
    const narrow = page.locator('[data-part="heatmap-narrow"]');
    const wide = page.locator('[data-part="heatmap-wide"]');
    await expect(narrow).toBeVisible();
    await expect(wide).toBeHidden();
    await expect(narrow.locator('[data-part="col-label"]')).toHaveCount(6);
    // 7 曜日 × 6 区分。
    await expect(narrow.locator('rect[data-part="cell"]')).toHaveCount(42);
    const box = await narrow.boundingBox();
    expect(box?.width ?? 999).toBeLessThanOrEqual(360);
  });

  test('E-13: S-06b は狭い画面用の格子（直近 12 か月）。横スクロールは子カテゴリのときだけ', async ({
    page,
  }) => {
    // 親カテゴリ（既定）: 行と列を入れ替えた格子で、横スクロールがない（05 §7.2）。
    await openScreen(page, '/categories/seasonal');
    await expect(page.locator('[data-view="narrow"]')).toBeVisible();
    await expect(page.locator('[data-view="wide"]')).toBeHidden();
    await expect(page.getByText(t('s06b.period.narrow'), { exact: true })).toBeVisible();
    await expect(page.getByText(t('s06b.scroll'), { exact: true })).toHaveCount(0);
    expect((await overflow(page)).scrollWidth, '親カテゴリの横スクロール').toBeLessThanOrEqual(360);

    // 子カテゴリ: 横にスクロールできることの案内が、表の上に出る。
    await openScreen(page, '/categories/seasonal?axis=child');
    await expect(page.locator('[data-view="narrow"]')).toBeVisible();
    await expect(page.getByText(t('s06b.scroll'), { exact: true }).first()).toBeVisible();
    // スクロールするのは格子の入れ物だけで、ページ全体は横に動かない。
    expect((await overflow(page)).scrollWidth, '子カテゴリのページ全体').toBeLessThanOrEqual(360);
  });
});
