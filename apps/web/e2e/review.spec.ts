import { expect, test, type Page } from '@playwright/test';

import { t } from '../src/lib/ui-text';

import { SCREENS, mainText, openScreen, periodButton } from './support/screens';

/**
 * 画面レビューの反映（07 §6 の E-22。責めない形。advice/2026-11-03-screens-review.md）。
 */

const BAND_DOT_POSITIONS = ['12.5%', '50%', '87.5%'];

/** 3 つの期間それぞれの main の文字。 */
async function textsByPeriod(page: Page, path: string): Promise<Record<string, string>> {
  await openScreen(page, path);
  const texts: Record<string, string> = { last28: await mainText(page) };
  for (const id of ['last7', 'last90'] as const) {
    await periodButton(page, id).click();
    await expect(periodButton(page, id)).toHaveAttribute('aria-pressed', 'true');
    texts[id] = await mainText(page);
  }
  return texts;
}

test.describe('画面レビューの反映（E-22）', () => {
  test('E-22 S-03: ▲▼ と「前の 28 日と比べて」がなく、「公開からの合計は」がある', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    for (const path of ['/articles/111', '/articles/101', '/articles/102', '/articles/105']) {
      await openScreen(page, path);
      await expect.soft(page.locator('h1'), `${path} の h1`).toHaveText('この記事はどう読まれた？');
      for (const [period, text] of Object.entries(await textsByPeriod(page, path))) {
        const name = `${path}（${period}）`;
        // 記事は前の期間と比べない（増減の矢印も、比べる文も出さない）。
        expect.soft(text, `${name} の ▲`).not.toContain(t('compare.arrow.up'));
        expect.soft(text, `${name} の ▼`).not.toContain(t('compare.arrow.down'));
        expect.soft(text, `${name} の比較の文`).not.toMatch(/前の \d+ 日と比べて|前の月と比べて/);
        expect.soft(text, `${name} の合計`).toContain('公開からの合計は');
      }
    }
    // 数え始める前に公開した記事は、「（計測開始日）からの合計は」になる。
    await openScreen(page, '/articles/107');
    const text = await mainText(page);
    expect(text).toMatch(/\d{4} 年 \d+ 月 \d+ 日からの合計は [\d,]+ 回です/);
    expect(text).not.toContain('公開からの合計は');
    expect(text).not.toContain(t('compare.arrow.up'));
    expect(text).not.toContain(t('compare.arrow.down'));
  });

  test('E-22 S-03: PeriodPicker が、読まれ方・お知らせ・これまでの記事との比較の後ろにある', async ({
    page,
  }) => {
    await openScreen(page, '/articles/111');
    const order = await page
      .locator('main')
      .evaluate((main) =>
        [...main.querySelectorAll('h2, [role="group"]')].map(
          (element) => element.getAttribute('aria-label') ?? (element.textContent ?? '').trim(),
        ),
      );
    const picker = order.indexOf(t('period.picker'));
    expect(picker, `期間の選択がある: ${order.join(' / ')}`).toBeGreaterThan(-1);
    expect(order.filter((item) => item === t('period.picker'))).toHaveLength(1);
    const before = [
      t('metric.M18.label'),
      t('metric.M23.label'),
      t('s03.own.h2', { name: '架空 二子' }),
    ];
    for (const heading of before) {
      const index = order.indexOf(heading);
      expect.soft(index, `「${heading}」がある`).toBeGreaterThan(-1);
      expect.soft(index, `「${heading}」は期間の選択より前`).toBeLessThan(picker);
    }
    // 期間で変わる部分は、選択より後ろ。
    for (const heading of [t('s03.period.h2'), t('s03.daily.h2'), t('s03.source.h2')]) {
      expect
        .soft(order.indexOf(heading), `「${heading}」は期間の選択より後ろ`)
        .toBeGreaterThan(picker);
    }
    // 期間を変えても、選択より前の部分は変わらない。
    const head = async () => (await mainText(page)).split(t('s03.periodPart.lead'))[0];
    const head28 = await head();
    await periodButton(page, 'last7').click();
    await expect(periodButton(page, 'last7')).toHaveAttribute('aria-pressed', 'true');
    expect(await head()).toBe(head28);
  });

  test('E-22 S-05: 「1 人あたり」「真ん中です」がなく、(b) の文が決まった形で始まる', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const authors: [string, string][] = [
      ['author-a', '架空 一郎'],
      ['author-b', '架空 二子'],
      ['author-c', '架空 三太'],
    ];
    for (const [slug, name] of authors) {
      for (const [period, text] of Object.entries(await textsByPeriod(page, `/authors/${slug}`))) {
        const label = `${slug}（${period}）`;
        expect.soft(text, `${label} の「1 人あたり」`).not.toContain('1 人あたり');
        expect.soft(text, `${label} の「真ん中です」`).not.toContain('真ん中です');
        expect.soft(text, `${label} の人数の比較`).not.toMatch(/ライターの(平均|中央値|真ん中)/);
        // 旧 (e)（多くの記事の範囲だけを別の行に書く文）がない。範囲は (b) の文の中にだけ出る。
        const lines = text.split('\n').map((line) => line.trim());
        expect
          .soft(
            lines.filter((line) => /^(このサイトの)?多くの記事は/.test(line)),
            `${label} の別行の文`,
          )
          .toEqual([]);
        const b = lines.filter(
          (line) => line.includes('公開から 30 日で') && line.includes('さんの記事は'),
        );
        if (slug === 'author-a') {
          // 記事が 5 本未満: (b) のかわりに、いつ出るかを書く。
          expect.soft(b, `${label} の (b)`).toEqual([]);
          expect
            .soft(text, `${label} の不在文`)
            .toContain(t('s05.summary.b.absent', { condition: t('absent.ownMedian') }));
        } else {
          expect.soft(b, `${label} の (b) は 1 行`).toHaveLength(1);
          expect
            .soft(b[0] ?? '', `${label} の (b) の始まり`)
            .toMatch(
              new RegExp(`^${name}さんの記事は、公開から 30 日で [\\d,]+ 回くらい読まれています。`),
            );
          expect.soft(b[0] ?? '', `${label} の (b) に多くの記事の範囲`).toContain('多くの記事は');
        }
      }
    }
  });

  test('E-22 S-05: 期間内の公開が 0 本の著者は「新しく公開した記事はありません」になる', async ({
    page,
  }) => {
    // author-c は、どの期間にも公開がない（記事はすべて公開から 91 日以上）。
    for (const [period, text] of Object.entries(await textsByPeriod(page, '/authors/author-c'))) {
      expect.soft(text, `author-c（${period}）`).toContain('新しく公開した記事はありません');
      expect.soft(text, `author-c（${period}）`).not.toContain('0 本公開し');
      expect
        .soft(text, `author-c（${period}）の以前の記事`)
        .toMatch(/以前に書いた \d+ 本の記事が [\d,]+ 回読まれました/);
    }
    // author-a は直近 28 日に 2 本公開した。
    await openScreen(page, '/authors/author-a');
    const text = await mainText(page);
    expect(text).toContain('この期間に 2 本公開し');
    expect(text).not.toContain('新しく公開した記事はありません');
  });

  test('E-22 S-05: 到達がない期間には「到達のお知らせ」の見出しがない', async ({ page }) => {
    const heading = page
      .locator('main')
      .getByRole('heading', { name: t('metric.M23.label'), exact: true });
    // author-c: 直近 28 日に到達した記事がない。
    await openScreen(page, '/authors/author-c');
    await expect(heading).toHaveCount(0);
    expect(await mainText(page)).not.toContain(t('absent.milestone'));
    // author-a: 記事 103 が基準日の 3 日前に 500 回に到達した。
    await openScreen(page, '/authors/author-a');
    await expect(heading).toHaveCount(1);
    expect(await mainText(page)).toMatch(/架空の記事 103 [^\n]+\n500 回読まれました/);
  });

  test('E-22: S-02b と S-05 の BandDot の点の cx が 3 つの固定値のいずれか', async ({ page }) => {
    const seen = new Set<string>();
    for (const path of [
      '/articles/new?p=last90',
      '/authors/author-a',
      '/authors/author-b',
      '/authors/author-d',
    ]) {
      await openScreen(page, path);
      const positions = await page
        .locator('circle[data-part="dot"]')
        .evaluateAll((dots) => dots.map((dot) => dot.getAttribute('cx') ?? ''));
      expect.soft(positions.length, `${path} の点の数`).toBeGreaterThan(0);
      for (const position of positions) {
        seen.add(position);
        // 値の大小で点を動かさない（区分ごとに決まった位置）。
        expect.soft(BAND_DOT_POSITIONS, `${path} の点の位置 ${position}`).toContain(position);
      }
    }
    expect([...seen].sort()).toEqual([...BAND_DOT_POSITIONS].sort());
  });

  test('E-22 S-01: 「読者はどんな人？」の details が幅 1280 で開き、360 で閉じている', async ({
    page,
  }) => {
    const readers = page
      .locator('details')
      .filter({ has: page.locator('summary', { hasText: t('s01.readers.h2') }) });
    await page.setViewportSize({ width: 1280, height: 800 });
    await openScreen(page, '/');
    await expect(readers).toHaveCount(1);
    await expect(readers).toHaveJSProperty('open', true);
    await expect(page.locator('[data-part="heatmap-wide"]')).toBeVisible();

    await page.setViewportSize({ width: 360, height: 740 });
    await openScreen(page, '/');
    await expect(readers).toHaveJSProperty('open', false);
    await expect(page.locator('[data-part="heatmap"]')).toBeHidden();
    // 閉じていても、見出しは読める。開くと中身が出る。
    const summary = page.locator('summary', { hasText: t('s01.readers.h2') });
    await expect(summary).toBeVisible();
    await summary.click();
    await expect(readers).toHaveJSProperty('open', true);
    await expect(page.locator('[data-part="heatmap-narrow"]')).toBeVisible();
  });

  test('E-22 S-01: 各 HBar の節に「〜のうち」の前置きがある', async ({ page }) => {
    for (const period of ['last28', 'last7', 'last90']) {
      await openScreen(page, `/?p=${period}`);
      for (const part of ['channel', 'sns', 'device', 'region', 'new-returning']) {
        const node = page.locator(`[data-part="${part}"]`);
        await expect.soft(node, `${period} の ${part}`).toHaveCount(1);
        const bars = await node.locator('svg rect[data-part="bar"]').count();
        const leads = await node
          .locator('[data-part="lead"]')
          .evaluateAll((items) => items.map((item) => (item.textContent ?? '').trim()));
        expect.soft(bars, `${period} の ${part} の棒`).toBeGreaterThan(0);
        expect.soft(leads.length, `${period} の ${part} の前置き`).toBeGreaterThan(0);
        for (const lead of leads) {
          expect
            .soft(lead, `${period} の ${part} の前置きの形`)
            .toMatch(/^(訪問|読まれた|読んだ人) [\d,]+ (回|人)のうち/);
        }
      }
    }
  });

  test('E-22: 全画面に「〜のため出ません」の形の不在文がない', async ({ page }) => {
    test.setTimeout(120_000);
    for (const screen of SCREENS) {
      await openScreen(page, screen.path);
      const text = await page.locator('body').evaluate((body) => body.textContent ?? '');
      const visible = await page.locator('body').innerText();
      for (const [name, source] of [
        ['見えている文字', visible],
        [
          '隠れている文字を含む全体',
          text.replace(/self\.__next_f\.push\([\s\S]*?\)(?=self\.__next_f|$)/g, ''),
        ],
      ] as const) {
        expect
          .soft(
            /(ため|ので)、?[^。\n]{0,20}(出ません|表示されません|表示しません)/.test(source),
            `${screen.id} の${name}`,
          )
          .toBe(false);
      }
    }
  });
});
