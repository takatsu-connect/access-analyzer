import { expect, test } from '@playwright/test';

import { SCREENS, bodyText, openScreen, periodButton } from './support/screens';

/**
 * 文言（07 §6 の E-12。NFR-97、NFR-99）。
 * 辞書の検査（tests/lib/ui-text.test.ts、scripts/check-forbidden-words.mjs）とは別に、
 * 実際に描かれた画面の文字を見る（データから来る文字と、差し込みで出来た文を含む）。
 */

// 05 §2.1 の「使わない語」。07 の E-12 の一覧に、README の一覧（少ない、悪い、低い、ワースト、ベスト）を足した。
const FORBIDDEN_WORDS = [
  '偏り',
  '下位',
  '読まれなかった',
  '順位',
  'ランキング',
  'あなた',
  '鮮度',
  '（軸）',
  'ワースト',
  'ベスト',
];

/** 見えている文字と、閉じた details などに隠れている文字の両方（script の中身は除く）。 */
async function allText(page: import('@playwright/test').Page): Promise<string> {
  const hidden = await page.locator('body').evaluate((body) => {
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    const parts: string[] = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement?.closest('script, style') !== null) continue;
      parts.push(node.nodeValue ?? '');
    }
    return parts.join('\n');
  });
  const labels = await page
    .locator('[aria-label], [title]')
    .evaluateAll((elements) =>
      elements.map(
        (element) =>
          `${element.getAttribute('aria-label') ?? ''}\n${element.getAttribute('title') ?? ''}`,
      ),
    );
  const svgTitles = await page
    .locator('svg title, svg desc')
    .evaluateAll((elements) => elements.map((element) => element.textContent ?? ''));
  return [await bodyText(page), hidden, ...labels, ...svgTitles, await page.title()].join('\n');
}

test.describe('文言（E-12）', () => {
  test('E-12: 全画面の本文に、使わない語がない（3 つの期間で）', async ({ page }) => {
    test.setTimeout(180_000);
    for (const screen of SCREENS) {
      await openScreen(page, screen.path);
      const texts = [await allText(page)];
      // 期間で文が変わる画面は、直近 7 日と直近 90 日でも見る。
      for (const id of ['last7', 'last90'] as const) {
        if ((await periodButton(page, id).count()) === 0) continue;
        await periodButton(page, id).click();
        texts.push(await allText(page));
      }
      const text = texts.join('\n');
      for (const word of FORBIDDEN_WORDS) {
        expect.soft(text.includes(word), `${screen.id} に「${word}」がない`).toBe(false);
      }
    }
  });

  test('E-12: 全画面の本文に、「出ません」で終わる文がない', async ({ page }) => {
    test.setTimeout(180_000);
    for (const screen of SCREENS) {
      await openScreen(page, screen.path);
      const texts = [await allText(page)];
      for (const id of ['last7', 'last90'] as const) {
        if ((await periodButton(page, id).count()) === 0) continue;
        await periodButton(page, id).click();
        texts.push(await allText(page));
      }
      // 文の終わり（。、行末、閉じ括弧の前）の「出ません」「表示されません」「ありません（値の不在）」。
      const endings = texts
        .join('\n')
        .split(/[。\n]/)
        .map((sentence) => sentence.trim())
        .filter((sentence) => /(出ません|表示されません|表示できません)[）」]?$/.test(sentence));
      // 「表示できませんでした」（エラーの文）は対象外。
      expect.soft(endings, `${screen.id} の「出ません」で終わる文`).toEqual([]);
    }
  });

  test('E-12: 値がまだないところは「〜になると出ます」「〜に出ます」の形（記事 101、author-a）', async ({
    page,
  }) => {
    await openScreen(page, '/articles/101');
    const article = await page.locator('main').innerText();
    // 公開から 2 日目: 500 回の到達、著者の過去の記事との比較、リンク元が、まだない。
    const absents = article.split('\n').filter((line) => /出ます$/.test(line.trim()));
    expect(absents.length).toBeGreaterThanOrEqual(3);
    for (const line of absents) {
      expect.soft(line, '不在文の形').toMatch(/(と|に|後に)(、最初のお知らせが)?出ます$/);
    }
  });
});
