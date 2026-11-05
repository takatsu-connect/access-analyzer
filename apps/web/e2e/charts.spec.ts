import { expect, test, type Locator, type Page } from '@playwright/test';

import { t } from '../src/lib/ui-text';

import { addDays, mainText, openScreen, periodButton } from './support/screens';

/**
 * グラフと色（07 §6 の E-11、E-19。NFR-97、FR-11、M-26）。
 * 日付は、グラフの当たり判定（data-date）から基準日を読んで、相対で確かめる。
 */

type Hit = { date: string; x: number; width: number };

function dailySection(page: Page): Locator {
  return page.locator('[data-section="daily"]');
}

/** 日別推移の当たり判定（1 日または 1 週に 1 つ）。x と width は % の数。 */
function readHits(chart: Locator): Promise<Hit[]> {
  return chart.locator('[data-part="hit"]').evaluateAll((rects) =>
    rects.map((rect) => ({
      date: rect.getAttribute('data-date') ?? '',
      x: Number.parseFloat(rect.getAttribute('x') ?? ''),
      width: Number.parseFloat(rect.getAttribute('width') ?? ''),
    })),
  );
}

function monthDay(isoDate: string): string {
  return t('format.monthDay', {
    month: Number(isoDate.slice(5, 7)),
    day: Number(isoDate.slice(8, 10)),
  });
}

/** rgb(…) / rgba(…) を色相（0〜360）、彩度、明度、不透明度にする。色でなければ null。 */
function toHsl(color: string): { h: number; s: number; l: number; a: number } | null {
  const match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?\s*\)$/.exec(
    color,
  );
  if (match === null) return null;
  const [r, g, b] = [match[1], match[2], match[3]].map((value) => Number(value) / 255) as [
    number,
    number,
    number,
  ];
  const a = match[4] === undefined ? 1 : Number(match[4]);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l, a };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return { h, s, l, a };
}

/** main の中の、見えている要素の色（文字、背景、枠、塗り、線）の種類。 */
function usedColors(page: Page): Promise<string[]> {
  return page.locator('main').evaluate((main) => {
    const colors = new Set<string>();
    for (const element of main.querySelectorAll('*')) {
      if (!element.checkVisibility({ visibilityProperty: true })) continue;
      const style = getComputedStyle(element);
      colors.add(style.color);
      colors.add(style.backgroundColor);
      colors.add(style.borderTopColor);
      colors.add(style.borderBottomColor);
      if (element instanceof SVGElement) {
        colors.add(style.fill);
        colors.add(style.stroke);
      }
    }
    return [...colors];
  });
}

test.describe('グラフと色（E-11、E-19）', () => {
  test('検査の関数が、赤と緑を見分ける', () => {
    expect(Math.round(toHsl('rgb(255, 0, 0)')?.h ?? -1)).toBe(0);
    expect(Math.round(toHsl('rgb(0, 128, 0)')?.h ?? -1)).toBe(120);
    expect(Math.round(toHsl('rgb(26, 76, 139)')?.h ?? -1)).toBe(213);
    expect(toHsl('rgba(0, 0, 0, 0)')?.a).toBe(0);
    expect(toHsl('none')).toBeNull();
  });

  test('E-11: 記事と著者の画面の色に、赤・緑系の色がなく、基調色の濃淡とグレーだけ', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const paths = [
      '/',
      '/articles/top',
      '/articles/new?p=last90',
      '/articles/recent',
      '/articles/111',
      '/articles/101',
      '/authors/author-a',
      '/authors/author-c',
      '/categories',
      '/categories/seasonal',
      '/activity',
    ];
    // 基調色（--shade-5）の色相。
    await openScreen(page, '/');
    const base = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--shade-5').trim(),
    );
    expect(base, 'globals.css のトークンが当たっている').not.toBe('');

    let chromatic = 0;
    const hues: number[] = [];
    for (const path of paths) {
      await openScreen(page, path);
      await page.evaluate(() => {
        for (const details of document.querySelectorAll('details')) details.open = true;
      });
      for (const color of await usedColors(page)) {
        const hsl = toHsl(color);
        if (hsl === null || hsl.a === 0) continue;
        // 彩度の低い色（グレー、黒、白）は色相を見ない。
        if (hsl.s < 0.12 || hsl.l < 0.06 || hsl.l > 0.97) continue;
        chromatic += 1;
        hues.push(hsl.h);
        const red = hsl.h <= 20 || hsl.h >= 340;
        const green = hsl.h >= 100 && hsl.h <= 160;
        const yellow = hsl.h > 20 && hsl.h < 70;
        expect.soft(red, `${path} の ${color} は赤系でない`).toBe(false);
        expect.soft(green, `${path} の ${color} は緑系でない`).toBe(false);
        expect.soft(yellow, `${path} の ${color} は黄・橙系でない`).toBe(false);
      }
    }
    expect(chromatic).toBeGreaterThan(10);
    // 色のついた要素は、どれも 1 つの基調色の濃淡（色相の幅が狭い）。
    expect(
      Math.max(...hues) - Math.min(...hues),
      `色相の幅: ${Math.min(...hues)}〜${Math.max(...hues)}`,
    ).toBeLessThan(40);
  });

  test('E-11: 帯の 3 区分が同じ色（文字、背景、点、帯）', async ({ page }) => {
    await openScreen(page, '/articles/new?p=last90');
    const styles = await page.locator('main').evaluate((main) => {
      const result: Record<string, string[]> = {};
      for (const svg of main.querySelectorAll('svg')) {
        const dot = svg.querySelector('[data-part="dot"]');
        if (dot === null) continue;
        const label = (svg.querySelector('title')?.textContent ?? '').trim();
        const cell = svg.closest('td');
        const cellStyle = cell === null ? null : getComputedStyle(cell);
        const texts = cell === null ? [] : [...cell.querySelectorAll('span, p, small')];
        const signature = [
          getComputedStyle(dot).fill,
          [...svg.querySelectorAll('rect')].map((rect) => getComputedStyle(rect).fill).join('/'),
          [...svg.querySelectorAll('line')].map((line) => getComputedStyle(line).stroke).join('/'),
          cellStyle?.color ?? '',
          cellStyle?.backgroundColor ?? '',
          [...new Set(texts.map((text) => getComputedStyle(text).color))].join('/'),
          [...new Set(texts.map((text) => getComputedStyle(text).fontWeight))].join('/'),
        ].join(' | ');
        result[label] = [...new Set([...(result[label] ?? []), signature])];
      }
      return result;
    });
    // 3 つの区分がどれも出ている。
    expect(Object.keys(styles).sort()).toEqual(
      [t('band.upper'), t('band.middle'), t('band.lower')].sort(),
    );
    const signatures = new Set(Object.values(styles).flat());
    expect([...signatures], '区分ごとの色の組').toHaveLength(1);
  });

  test('E-19: S-01 の日別推移の切り替えは「読まれた回数」「訪問回数」の 2 つだけ', async ({
    page,
  }) => {
    await openScreen(page, '/');
    const section = dailySection(page);
    const metric = section.getByRole('group', { name: t('s01.daily.metric.aria'), exact: true });
    const labels = (await metric.getByRole('button').allInnerTexts()).map((label) => label.trim());
    expect(labels).toEqual([t('metric.M01.label'), t('metric.M02.label')]);
    // 読んだ人の数の選択肢がない（日ごとの人数は足し合わせられない）。
    const controls = await section
      .locator('button, option, label')
      .evaluateAll((elements) => elements.map((element) => element.textContent ?? ''));
    expect(controls.filter((label) => label.includes('読んだ人'))).toEqual([]);

    // 訪問回数に切り替えると、固定行の数字の名前が変わる。
    await metric.getByRole('button', { name: t('metric.M02.label'), exact: true }).click();
    await expect(section.locator('[data-part="fixed-row"]')).toContainText(t('metric.M02.label'));
  });

  test('E-19: 未確定の 3 日が薄いクラスで、前の期間の線は点線で別のクラス', async ({ page }) => {
    await openScreen(page, '/');
    const section = dailySection(page);
    const hits = await readHits(section);
    expect(hits).toHaveLength(28);
    const base = hits.at(-1)?.date ?? '';
    expect(base).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // 未確定の帯は、基準日の 2 日前から右端まで（3 日分）。
    const band = section.locator('[data-part="unconfirmed-band"]');
    await expect(band).toHaveCount(1);
    const bandBox = await band.evaluate((rect) => ({
      x: Number.parseFloat(rect.getAttribute('x') ?? ''),
      width: Number.parseFloat(rect.getAttribute('width') ?? ''),
      className: rect.getAttribute('class') ?? '',
    }));
    const firstUnconfirmed = hits.find((hit) => hit.date === addDays(base, -2));
    expect(bandBox.x).toBeCloseTo(firstUnconfirmed?.x ?? -1, 1);
    expect(bandBox.x + bandBox.width).toBeCloseTo(100, 1);
    expect(bandBox.className).not.toBe('');

    const lineStyle = (name: string) =>
      section.locator(`path[data-series="${name}"]`).evaluate((path) => {
        const style = getComputedStyle(path);
        return {
          className: path.getAttribute('class') ?? '',
          dash: style.strokeDasharray,
          stroke: style.stroke,
        };
      });
    const current = await lineStyle('current');
    const prev = await lineStyle('prev');
    const unconfirmed = await lineStyle('unconfirmed');
    // 前の期間の線は点線で、クラスも違う（色だけで見分けさせない）。
    expect(prev.dash).not.toBe('none');
    expect(current.dash).toBe('none');
    expect(prev.className).not.toBe(current.className);
    // 未確定の部分は、この期間の線とは別のクラスで、薄い色。
    expect(unconfirmed.className).not.toBe(current.className);
    expect(unconfirmed.stroke).not.toBe(current.stroke);
    // 凡例に、薄い色の説明と、前の期間がある。
    const text = await section.innerText();
    expect(text).toContain(t('legend.unconfirmed'));
    expect(text).toContain(t('legend.prev'));
  });

  test('E-19: 公開日の点が、フィクスチャの公開日に一致する', async ({ page }) => {
    await openScreen(page, '/');
    const section = dailySection(page);
    const hits = await readHits(section);
    const base = hits.at(-1)?.date ?? '';
    const centers = await section
      .locator('[data-part="published-dot"]')
      .evaluateAll((dots) => dots.map((dot) => Number.parseFloat(dot.getAttribute('cx') ?? '')));
    const dates = centers.map(
      (cx) => hits.find((hit) => hit.x <= cx && cx < hit.x + hit.width)?.date ?? `不明（${cx}）`,
    );
    // 直近 28 日に公開したのは、記事 101（基準日の 1 日前）と 102（6 日前）。
    expect(dates.sort()).toEqual([addDays(base, -6), addDays(base, -1)]);

    // 公開した日を選ぶと、固定行に本数が出る。
    await section
      .locator(`[data-part="hit"][data-date="${addDays(base, -6)}"]`)
      .click({ force: true });
    const row = section.locator('[data-part="fixed-row"]');
    await expect(row).toContainText(monthDay(addDays(base, -6)));
    await expect(row).toContainText(t('chart.fixedRow.published', { n: 1 }));
    // 公開のない日には、本数の添え書きがない。
    await section
      .locator(`[data-part="hit"][data-date="${addDays(base, -10)}"]`)
      .click({ force: true });
    await expect(row).toContainText(monthDay(addDays(base, -10)));
    await expect(row).not.toContainText('本公開');
  });

  test('E-19: 90 日を選ぶと週別が既定で、日別に切り替えられる', async ({ page }) => {
    await openScreen(page, '/');
    const section = dailySection(page);
    const grain = section.getByRole('group', { name: t('s01.daily.grain.aria'), exact: true });
    // 直近 28 日には、週別と日別の切り替えがない。
    await expect(grain).toHaveCount(0);

    await periodButton(page, 'last90').click();
    const week = grain.getByRole('button', { name: t('s01.daily.grain.week'), exact: true });
    const day = grain.getByRole('button', { name: t('s01.daily.grain.day'), exact: true });
    await expect(week).toHaveAttribute('aria-pressed', 'true');
    await expect(day).toHaveAttribute('aria-pressed', 'false');
    const weekly = await readHits(section);
    expect(weekly.length).toBeGreaterThanOrEqual(12);
    expect(weekly.length).toBeLessThanOrEqual(14);

    await day.click();
    await expect(day).toHaveAttribute('aria-pressed', 'true');
    await expect(week).toHaveAttribute('aria-pressed', 'false');
    await expect(section.locator('[data-part="hit"]')).toHaveCount(90);
  });

  test('E-19: 固定行が初期表示から埋まり、行頭にタップの案内がある', async ({ page, request }) => {
    // 配信された HTML（スクリプトが動く前）に、固定行の文が入っている。
    const html = await (await request.get('/')).text();
    const fixed = /data-part="fixed-row"[^>]*>([^<]+)</.exec(html)?.[1] ?? '';
    expect(fixed).toMatch(/\d+ 月 \d+ 日: 読まれた回数 [\d,]+（前の期間の同じ日: [\d,]+）/);
    expect(html.indexOf(t('chart.tap.hint'))).toBeGreaterThan(-1);
    expect(html.indexOf(t('chart.tap.hint'))).toBeLessThan(html.indexOf('data-part="fixed-row"'));

    await openScreen(page, '/');
    const section = dailySection(page);
    const row = section.locator('[data-part="fixed-row"]');
    await expect(row).toHaveCount(1);
    await expect(row).toHaveText(/\d+ 月 \d+ 日: 読まれた回数 [\d,]+（前の期間の同じ日: [\d,]+）/);
    // 固定行のすぐ前に、案内の文がある。
    const before = await row.evaluate(
      (element) => element.previousElementSibling?.textContent ?? '',
    );
    expect(before).toBe(t('chart.tap.hint'));
    // 初めに選ばれているのは、数字が確定した最後の日（基準日の 3 日前）。
    const hits = await readHits(section);
    const base = hits.at(-1)?.date ?? '';
    await expect(row).toContainText(monthDay(addDays(base, -3)));
  });

  test('E-19: S-03 の日別推移に、前の期間の線がない', async ({ page }) => {
    for (const path of ['/articles/111', '/articles/101', '/articles/107']) {
      await openScreen(page, path);
      // 公開から 2 日目の記事（101）は、線の全体が未確定の部分になる。
      const lines = page.locator('[data-series="current"], [data-series="unconfirmed"]');
      expect.soft(await lines.count(), `${path} の線`).toBeGreaterThan(0);
      await expect
        .soft(page.locator('[data-series="prev"]'), `${path} の前の期間の線`)
        .toHaveCount(0);
      const text = await mainText(page);
      expect.soft(text, `${path} の凡例`).not.toContain(t('legend.prev'));
      expect.soft(text, `${path} の固定行`).not.toContain('前の期間の同じ日');
      expect.soft(text, `${path} の案内`).toContain(t('chart.tap.hint'));
    }
  });
});
