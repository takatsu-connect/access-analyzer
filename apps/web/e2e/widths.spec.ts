import { expect, test } from '@playwright/test';

import { SCREENS, openScreen } from './support/screens';

/**
 * 中間の幅（タブレットと小さめのノートパソコン）で、ページ全体が横にはみ出さないこと（E-13 の補い）。
 *
 * 2026-11-07、Chrome での確認で、列の多い記事の表（S-05 の 8 列）が幅 1,081px でページごと
 * 17px はみ出していた。360px（narrow.spec.ts）と 1,280px（ほかの spec）だけでは見つからなかった。
 * 表の枠の中の横スクロールは許す（ページ全体の幅だけを見る）。
 */
const WIDTHS = [800, 1024] as const;

for (const width of WIDTHS) {
  test.describe(`幅 ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test(`全画面で、ページ全体が横にはみ出さない（details を開いても）`, async ({ page }) => {
      test.setTimeout(180_000);
      for (const screen of SCREENS) {
        await openScreen(page, screen.path);
        await page.evaluate(() => {
          for (const details of document.querySelectorAll('details')) details.open = true;
        });
        const size = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect
          .soft(size.scrollWidth, `${screen.id}（幅 ${width}px）のページの横幅`)
          .toBeLessThanOrEqual(size.clientWidth);
      }
    });
  });
}
