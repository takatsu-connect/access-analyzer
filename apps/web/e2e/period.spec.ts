import { expect, test, type Page } from '@playwright/test';

import { t } from '../src/lib/ui-text';

import { mainText, openScreen, periodButton, watchPage } from './support/screens';

/**
 * 期間の切り替えと URL（07 §6 の E-06）と、期間に連動しない部分（E-20）。
 */

/** S-01 の主要な数字（読まれた回数、公開本数、読んだ人の数）の文字。 */
function kpiText(page: Page): Promise<string> {
  return page.locator('[data-section="kpi"]').innerText();
}

/** 表の名前（caption）で表を引く。 */
function tableByCaption(page: Page, caption: string) {
  return page.locator('table').filter({
    has: page.locator('caption', { hasText: new RegExp(`^${caption}$`) }),
  });
}

/** S-03 のリンク元の表（列の見出しが「リンク元のサイト」の表）。 */
function referrerTable(page: Page) {
  return page.locator('table').filter({
    has: page.locator('thead th', { hasText: new RegExp(`^${t('column.domain')}$`) }),
  });
}

test.describe('期間の切り替えと URL（E-06、E-20）', () => {
  test('E-06: 期間を選ぶと表示が変わり、URL の ?p= が同期する', async ({ page }) => {
    await openScreen(page, '/');
    await expect(periodButton(page, 'last28')).toHaveAttribute('aria-pressed', 'true');
    const kpi28 = await kpiText(page);

    await periodButton(page, 'last7').click();
    await expect(periodButton(page, 'last7')).toHaveAttribute('aria-pressed', 'true');
    await expect(periodButton(page, 'last28')).toHaveAttribute('aria-pressed', 'false');
    await expect(page).toHaveURL(/[?&]p=last7(&|$)/);
    const kpi7 = await kpiText(page);
    expect(kpi7).not.toBe(kpi28);
    expect(kpi7).toContain(t('compare.prevWindow', { days: 7 }));

    await periodButton(page, 'last90').click();
    await expect(page).toHaveURL(/[?&]p=last90(&|$)/);
    const kpi90 = await kpiText(page);
    expect(kpi90).not.toBe(kpi28);
    expect(kpi90).not.toBe(kpi7);

    // 月を選ぶ（確定した月。選択肢の 3 つめ以降）。
    const month = page.getByRole('group', { name: t('period.picker') }).locator('select');
    const values = await month
      .locator('option')
      .evaluateAll((options) => options.map((option) => option.getAttribute('value') ?? ''));
    const confirmed = values[3] ?? '';
    expect(confirmed).toMatch(/^m\d{4}-\d{2}$/);
    await month.selectOption(confirmed);
    await expect(page).toHaveURL(new RegExp(`[?&]p=${confirmed}(&|$)`));
    await expect(periodButton(page, 'last90')).toHaveAttribute('aria-pressed', 'false');
    expect(await kpiText(page)).toContain(t('compare.prevMonth'));

    // 直近 28 日に戻すと、最初の表示に戻る。
    await periodButton(page, 'last28').click();
    await expect(periodButton(page, 'last28')).toHaveAttribute('aria-pressed', 'true');
    expect(await kpiText(page)).toBe(kpi28);
  });

  test('E-06: 記事、著者、カテゴリ、シリーズ、投稿活動でも、期間と URL が同期する', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const paths = [
      '/articles',
      '/articles/top',
      '/articles/new',
      '/articles/long',
      '/articles/111',
      '/authors/author-a',
      '/categories',
      '/tags',
      '/tags/51',
      '/activity',
    ];
    for (const path of paths) {
      await openScreen(page, path);
      await expect
        .soft(periodButton(page, 'last28'), `${path} の既定は直近 28 日`)
        .toHaveAttribute('aria-pressed', 'true');
      await periodButton(page, 'last90').click();
      await expect
        .soft(periodButton(page, 'last90'), `${path} で直近 90 日を選べる`)
        .toHaveAttribute('aria-pressed', 'true');
      await expect.soft(page, `${path} の URL`).toHaveURL(/[?&]p=last90(&|$)/);
    }
  });

  test('E-06: 別のコンテキストで同じ URL を開くと同じ表示になる', async ({ page, browser }) => {
    await openScreen(page, '/');
    await periodButton(page, 'last7').click();
    await expect(page).toHaveURL(/[?&]p=last7(&|$)/);
    const url = page.url();
    const text = await mainText(page);

    const context = await browser.newContext();
    try {
      const other = await context.newPage();
      await openScreen(other, url);
      await expect(periodButton(other, 'last7')).toHaveAttribute('aria-pressed', 'true');
      expect(await mainText(other)).toBe(text);
    } finally {
      await context.close();
    }
  });

  test('E-06: 不正な ?p=（prev28、m1999-01、<script>）は直近 28 日になり、エラーが出ない', async ({
    page,
  }) => {
    const watch = await watchPage(page);
    await openScreen(page, '/');
    const expected = await mainText(page);

    const invalid = [
      'prev28',
      'm1999-01',
      '<script>alert(1)</script>',
      'last7"><img src=x onerror=alert(1)>',
      'LAST7',
      'm2026-13',
      '',
    ];
    for (const value of invalid) {
      await openScreen(page, `/?p=${encodeURIComponent(value)}`);
      await expect
        .soft(periodButton(page, 'last28'), `p=${value} は直近 28 日`)
        .toHaveAttribute('aria-pressed', 'true');
      expect.soft(await mainText(page), `p=${value} の表示は既定と同じ`).toBe(expected);
      await expect.soft(page.locator('h1'), `p=${value} の h1`).toHaveText(t('s01.h1'));
    }
    // 2 つ重ねたとき、知らないパラメータを足したときも、エラーにならない。
    await openScreen(page, '/?p=last7&p=last90&unknown=1&sort=pv');
    await expect(page.locator('h1')).toHaveText(t('s01.h1'));
    expect(watch.pageErrors).toEqual([]);
    expect(watch.dialogs).toEqual([]);
  });

  test('E-06: 不正な ?p= を開いても、CSP 違反が出ない', async ({ page, browserName }) => {
    // WebKit（Playwright の Desktop Safari）では、期間の月の選択（PeriodPicker の select）がある
    // 画面を開くたびに、style-src-attr の違反が 1 件出る（blockedURI は inline、対象は select 要素。
    // select のない /authors と 404 では出ない。DOM の select に style 属性はない）。?p= の値には
    // よらず、/ を素で開いても出る。Chromium と Firefox では 0 件。操作（月の選択を含む）は
    // WebKit でも効く。WebKit の select の描き方によるものか、実機の Safari でも出るかは未確認。
    // 該当: src/components/PeriodPicker.tsx の select（52 行付近）と PeriodPicker.module.css。
    test.fixme(
      browserName === 'webkit',
      'WebKit で、PeriodPicker の select に style-src-attr の CSP 違反が出る（原因は未確認）',
    );
    const watch = await watchPage(page);
    for (const value of ['prev28', 'm1999-01', '<script>alert(1)</script>', '']) {
      await openScreen(page, `/?p=${encodeURIComponent(value)}`);
      expect.soft(await watch.violations(), `p=${value} の CSP 違反`).toEqual([]);
    }
    expect(watch.consoleCsp).toEqual([]);
  });

  test('E-20: S-01 のリンク元と市別は、期間を変えても値と、集計した月の見出しが変わらない', async ({
    page,
  }) => {
    await openScreen(page, '/');
    const referrer = tableByCaption(page, t('metric.M12.label'));
    const city = tableByCaption(page, t('s01.city.label'));
    await expect(referrer).toHaveCount(1);
    await expect(city).toHaveCount(1);
    // 見出しは「リンク元のサイト（2026 年 9 月）」の形。月は基準日で変わるので、形で確かめる。
    const monthHeading = (label: string): RegExp =>
      new RegExp(`${label}（[0-9]{4} 年 [0-9]{1,2} 月）`);
    const referrerHeading = monthHeading(t('metric.M12.label'));
    const cityHeading = monthHeading(t('s01.city.label'));

    const before = {
      referrer: await referrer.innerText(),
      city: await city.innerText(),
      text: await mainText(page),
      kpi: await kpiText(page),
    };
    // 値が実際に入っている（フィクスチャの 4 行）。
    expect(before.referrer).toContain('news.example');
    expect(before.city).toContain('Kawasaki');
    expect(before.text).toMatch(referrerHeading);
    expect(before.text).toMatch(cityHeading);
    // 期間に連動しないことの注記。
    const note = t('s01.monthly.note');
    expect(before.text.split(note).length - 1, '連動しない注記は 2 か所').toBe(2);

    for (const id of ['last7', 'last90'] as const) {
      await periodButton(page, id).click();
      await expect(periodButton(page, id)).toHaveAttribute('aria-pressed', 'true');
      // 期間に連動する部分は変わっている。
      expect.soft(await kpiText(page), `${id} で主要な数字は変わる`).not.toBe(before.kpi);
      expect.soft(await referrer.innerText(), `${id} でリンク元は変わらない`).toBe(before.referrer);
      expect.soft(await city.innerText(), `${id} で市別は変わらない`).toBe(before.city);
      const text = await mainText(page);
      expect.soft(text, `${id} の見出し（リンク元）`).toMatch(referrerHeading);
      expect.soft(text, `${id} の見出し（市別）`).toMatch(cityHeading);
      expect.soft(text.split(note).length - 1, `${id} の連動しない注記`).toBe(2);
    }
  });

  test('E-20: S-03 のリンク元は、期間を変えても値と「公開から 30 日間の集計です」が変わらない', async ({
    page,
  }) => {
    await openScreen(page, '/articles/111');
    const table = referrerTable(page);
    const note = t('s03.referrer.note');
    expect(note).toContain('公開から 30 日間の集計です');
    await expect(table).toHaveCount(1);
    await expect(page.getByText(note, { exact: true })).toHaveCount(1);
    const before = await table.innerText();
    // フィクスチャ: 111 のリンク元は 2 つ（しきい値未満の 1 つは格納されない）。
    expect(before).toContain('news.example');
    expect(before).toContain('town.example');
    expect(before).not.toContain('tiny.example');
    const periodLine = page.getByText(/この期間に .+ 回読まれました/);
    const periodBefore = await periodLine.first().innerText();

    for (const id of ['last7', 'last90'] as const) {
      await periodButton(page, id).click();
      await expect(periodButton(page, id)).toHaveAttribute('aria-pressed', 'true');
      expect.soft(await table.innerText(), `${id} でリンク元は変わらない`).toBe(before);
      await expect.soft(page.getByText(note, { exact: true }), `${id} の注記`).toHaveCount(1);
    }
    // 期間に連動する部分（この期間に読まれた回数）は変わっている。
    expect(await periodLine.first().innerText()).not.toBe(periodBefore);
  });

  test('E-20: 30 日未満の記事のリンク元は、値のかわりに不在文（05 §2.1 の文言）になる', async ({
    page,
  }) => {
    await openScreen(page, '/articles/101');
    const absent = page.getByText(t('absent.referrer30'), { exact: true });
    await expect(absent).toHaveCount(1);
    await expect(absent).toBeVisible();
    await expect(page.getByText(t('s03.referrer.note'), { exact: true })).toHaveCount(1);
    await expect(referrerTable(page)).toHaveCount(0);
    // 期間を変えても同じ。
    for (const id of ['last7', 'last90'] as const) {
      await periodButton(page, id).click();
      await expect(periodButton(page, id)).toHaveAttribute('aria-pressed', 'true');
      await expect.soft(absent, `${id} の不在文`).toHaveCount(1);
      await expect.soft(referrerTable(page), `${id} のリンク元の表`).toHaveCount(0);
    }
  });

  // 設計の文書どうしの食い違い。06_acceptance.md（77 行）、04_functional.md（65 行）、07 の E-20 は
  // 「公開後 30 日で集計します」。05_screens.md（67、116、381 行）と 04_api.md、辞書
  // （src/lib/ui-text.ts の absent.referrer30）は「公開 30 日後に出ます」。画面は 05 のとおり。
  // どちらに合わせるかが決まったら、fixme を外すか、この試験を消す。
  test.fixme('E-20: 30 日未満の記事に「公開後 30 日で集計します」と出る（07 の文言）', async ({
    page,
  }) => {
    await openScreen(page, '/articles/101');
    expect(await mainText(page)).toContain('公開後 30 日で集計します');
  });
});
