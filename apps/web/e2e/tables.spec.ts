import { expect, test, type Locator, type Page } from '@playwright/test';

import { t } from '../src/lib/ui-text';

import { SCREENS, mainText, openScreen, periodButton } from './support/screens';

/**
 * 表の決まり（07 §6 の E-07〜E-10、E-15）。
 * 伏せ値と分母の場面は、フィクスチャ（apps/batch/tests/support/e2e_fixture.py の冒頭の表）にある。
 */

const MASKED_TEXT = `${t('masked.dash')}${t('masked.label')}`;

function sortGroup(page: Page): Locator {
  return page.getByRole('group', { name: t('sort.label'), exact: true });
}

function tableByCaption(page: Page, caption: string): Locator {
  return page.locator('table').filter({
    has: page.locator('caption', { hasText: new RegExp(`^${caption}$`) }),
  });
}

/** 記事の表（ArticleTable）の、ある列の文字を、記事の行の順に返す。 */
function articleColumn(page: Page, header: string): Promise<string[]> {
  return page
    .locator('table[role="table"]')
    .first()
    .evaluate((table, name) => {
      const heads = [...table.querySelectorAll('thead th')].map((cell) =>
        (cell.textContent ?? '').trim(),
      );
      const index = heads.indexOf(name);
      if (index < 0) return [];
      return [...table.querySelectorAll('tbody tr')]
        .filter((row) => row.querySelector('th[role="rowheader"]') !== null)
        .map((row) => {
          // 狭い画面用に名前を添えた中身（narrow-cell）と別に、広い画面の中身（wide-cell）を読む。
          const cell = row.children[index];
          return (
            (cell?.querySelector('[data-part="wide-cell"]') ?? cell)?.textContent ?? ''
          ).trim();
        });
    }, header);
}

function isDescending(values: readonly (string | number)[]): boolean {
  return values.every((value, index) => index === 0 || value <= (values[index - 1] ?? value));
}

/** 「1,234」の形の数だけを取り出す（伏せ値や不在文は除く）。 */
function numbersOf(texts: readonly string[]): number[] {
  return texts
    .filter((text) => /^[\d,]+$/.test(text))
    .map((text) => Number(text.replace(/,/g, '')));
}

type TableDump = { caption: string; head: string[]; rows: string[][] };

/** ページのすべての表の、見出しとセルの文字。閉じた details の中の表も含む。 */
function dumpTables(page: Page): Promise<TableDump[]> {
  return page.locator('main').evaluate((main) =>
    [...main.querySelectorAll('table')].map((table) => ({
      caption: (table.querySelector('caption')?.textContent ?? '').trim(),
      head: [...table.querySelectorAll('thead th')].map((cell) => (cell.textContent ?? '').trim()),
      rows: [...table.querySelectorAll('tbody tr')].map((row) =>
        [...row.children].map((cell) => (cell.textContent ?? '').replace(/\s+/g, ' ').trim()),
      ),
    })),
  );
}

/** 伏せ値の表示（MaskedCell）の、クラスと文字の組の種類。 */
function maskedShapes(page: Page): Promise<string[]> {
  return page.evaluate(() => [
    ...new Set(
      [...document.querySelectorAll('.masked')].map(
        (element) => `${element.className}|${element.textContent ?? ''}`,
      ),
    ),
  ]);
}

test.describe('表の決まり（E-07〜E-10、E-15）', () => {
  test('E-07: S-02e は絞り込みなし・親カテゴリのみでは並びの UI がなく、?sort=pv でも公開日順', async ({
    page,
  }) => {
    const paths = [
      '/articles',
      '/articles?sort=pv',
      '/articles?sort=pv7',
      '/articles?cat=1',
      '/articles?cat=1&sort=pv',
      '/articles?cat=2&sort=pv30',
    ];
    for (const path of paths) {
      await openScreen(page, path);
      await expect.soft(sortGroup(page), `${path} に並びの UI がない`).toHaveCount(0);
      await expect
        .soft(page.getByText(t('s02e.sort.fixed'), { exact: true }), `${path} の並びの説明`)
        .toHaveCount(1);
      const dates = await articleColumn(page, t('column.publishedOn'));
      expect.soft(dates.length, `${path} の記事の行`).toBeGreaterThan(2);
      expect.soft(isDescending(dates), `${path} は公開日の新しい順: ${dates.join(' ')}`).toBe(true);
    }
  });

  test('E-07: S-02e は著者 / 子カテゴリ / 公開年月で絞ると、多い順の UI が出る', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await openScreen(page, '/articles');
    // 公開年月の選択肢（YYYY-MM）。新しいほうから 2 つめを使う。
    const months = (
      await page
        .locator('select option')
        .evaluateAll((options) => options.map((option) => option.getAttribute('value') ?? ''))
    ).filter((value) => /^\d{4}-\d{2}$/.test(value));
    const month = months[1] ?? '';
    expect(month).not.toBe('');

    for (const query of ['author=author-b', 'cat=11', `ym=${month}`]) {
      await openScreen(page, `/articles?${query}`);
      const group = sortGroup(page);
      await expect.soft(group, `${query} で並びの UI が出る`).toHaveCount(1);
      await expect
        .soft(page.getByText(t('s02e.sort.fixed'), { exact: true }), `${query} の固定の説明`)
        .toHaveCount(0);
      const labels = (await group.getByRole('button').allInnerTexts()).map((label) => label.trim());
      expect.soft(labels, `${query} の並びの選択肢`).toContain(t('sort.published'));
      expect.soft(labels, `${query} の並びの選択肢`).toContain(t('sort.pv'));
      for (const label of labels.filter((item) => item !== t('sort.published'))) {
        expect.soft(label, `${query} の並びは多い順だけ`).toMatch(/多い順$/);
      }

      // 多い順を選ぶと、URL に入り、読まれた回数の多い順に並ぶ。
      await group.getByRole('button', { name: t('sort.pv'), exact: true }).click();
      await expect.soft(page, `${query} の URL`).toHaveURL(/[?&]sort=pv(&|$)/);
      const values = numbersOf(await articleColumn(page, t('column.pageviews.period')));
      expect.soft(values.length, `${query} の数のある行`).toBeGreaterThan(1);
      expect.soft(isDescending(values), `${query} は多い順: ${values.join(' ')}`).toBe(true);
    }

    // URL から直接開いても同じ。
    await openScreen(page, '/articles?author=author-b&sort=pv');
    await expect(
      sortGroup(page).getByRole('button', { name: t('sort.pv'), exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    const direct = numbersOf(await articleColumn(page, t('column.pageviews.period')));
    expect(isDescending(direct), `多い順: ${direct.join(' ')}`).toBe(true);
    // 公開日順とは違う並びになっている（並べ替えが実際に効いている）。
    const dates = await articleColumn(page, t('column.publishedOn'));
    expect(isDescending(dates)).toBe(false);
  });

  test('E-07: 少ない順の UI がどの画面にもない。S-05 は常に並べ替えできる', async ({ page }) => {
    test.setTimeout(120_000);
    for (const screen of SCREENS) {
      await openScreen(page, screen.path);
      // 隠れている要素も含めて、少ない順・昇順の選択肢がない。
      const labels = await page
        .locator('button, option, summary, label, a')
        .evaluateAll((elements) => elements.map((element) => (element.textContent ?? '').trim()));
      const ascending = labels.filter((label) => /少ない順|昇順|古い順/.test(label));
      expect.soft(ascending, `${screen.id} の少ない順の UI`).toEqual([]);
    }
    // 著者を並べ替える UI がない（S-04、S-08）。
    for (const path of ['/authors', '/activity']) {
      await openScreen(page, path);
      await expect.soft(sortGroup(page), `${path} に並びの UI がない`).toHaveCount(0);
    }

    for (const slug of ['author-a', 'author-b', 'author-c', 'author-d']) {
      await openScreen(page, `/authors/${slug}`);
      const group = sortGroup(page);
      await expect.soft(group, `${slug} の並びの UI`).toHaveCount(1);
      const labels = (await group.getByRole('button').allInnerTexts()).map((label) => label.trim());
      expect
        .soft(labels, `${slug} の並びの選択肢`)
        .toEqual([t('sort.published'), t('sort.pv'), t('sort.pv7'), t('sort.pv30')]);
    }
    // 選ぶと URL に入り、並びが変わる（author-b は記事が 20 本）。
    await openScreen(page, '/authors/author-b');
    await sortGroup(page)
      .getByRole('button', { name: t('sort.pv'), exact: true })
      .click();
    await expect(page).toHaveURL(/[?&]sort=pv(&|$)/);
    const values = numbersOf(await articleColumn(page, t('column.pageviews.period')));
    expect(values.length).toBeGreaterThan(2);
    expect(isDescending(values), `多い順: ${values.join(' ')}`).toBe(true);
  });

  test('E-08: 記事と著者の表に、連番の列と先頭の数字がない', async ({ page }) => {
    test.setTimeout(120_000);
    const paths = [
      '/articles/top',
      '/articles/top?p=last90&n=50',
      '/articles/new?p=last90',
      '/articles/long',
      '/articles/recent',
      '/articles',
      '/articles?author=author-b&sort=pv',
      '/authors/author-a',
      '/authors/author-b?sort=pv',
      '/tags/51',
      '/activity?p=last90',
    ];
    let tableCount = 0;
    for (const path of paths) {
      await openScreen(page, path);
      const tables = await dumpTables(page);
      tableCount += tables.length;
      for (const table of tables) {
        const name = `${path} の表「${table.caption}」`;
        // 見出しに、順位を表す列がない。
        for (const head of table.head) {
          expect.soft(head, `${name} の見出し`).not.toMatch(/^(#|No\.?|順|位)$|順位|ランク/i);
        }
        const rows = table.rows.filter((row) => row.length > 1);
        // 行の先頭のセルが「1 」「1. 」の形でない。数字だけでもない。
        // 月の表の「2026 年 11 月」は年なので、3 桁までの数を順位の形として見る。
        for (const row of rows) {
          expect.soft(row[0] ?? '', `${name} の行の先頭`).not.toMatch(/^\d{1,3}\.?(\s|$)/);
        }
        // 「◯ 位」のセルがない。
        for (const cell of rows.flat()) {
          expect.soft(cell, `${name} のセル`).not.toMatch(/^\d+\s*位$/);
        }
        // 1, 2, 3, … と並ぶ列（連番）がない。
        const width = Math.max(0, ...rows.map((row) => row.length));
        for (let column = 0; column < width && rows.length >= 3; column += 1) {
          const serial = rows.every((row, index) =>
            new RegExp(`^${index + 1}\\.?$`).test(row[column] ?? ''),
          );
          expect.soft(serial, `${name} の ${column + 1} 列目が連番`).toBe(false);
        }
      }
      // 番号つきのリストで並べていない。
      await expect.soft(page.locator('main ol'), `${path} の ol`).toHaveCount(0);
    }
    expect(tableCount).toBeGreaterThan(8);
  });

  test('E-08: S-08 のライターの表に 0 本の行がなく、見出しが「名前の順」', async ({ page }) => {
    // 名前の順（S-04 の並び）。
    await openScreen(page, '/authors');
    const nameOrder = (await page.locator('main a[href^="/authors/"]').allInnerTexts()).map(
      (name) => name.trim(),
    );
    expect(nameOrder).toHaveLength(4);

    await openScreen(page, '/activity');
    expect(t('s08.authors.h2')).toBe('この期間に記事を公開したライター（名前の順）');
    await expect(page.getByRole('heading', { name: t('s08.authors.h2'), exact: true })).toHaveCount(
      1,
    );
    const table = tableByCaption(page, t('s08.authors.h2'));
    await expect(table).toHaveCount(1);

    const readRows = () =>
      table
        .locator('tbody tr')
        .evaluateAll((rows) =>
          rows.map((row) => [...row.children].map((cell) => (cell.textContent ?? '').trim())),
        );

    // 直近 28 日: 公開したのは 架空 一郎 だけ（101 と 102）。
    const rows28 = await readRows();
    expect(rows28).toEqual([['架空 一郎', '2']]);

    // 直近 90 日: 架空 三太（公開から 91 日以上の記事だけ）は載らない。
    await periodButton(page, 'last90').click();
    await expect(periodButton(page, 'last90')).toHaveAttribute('aria-pressed', 'true');
    const rows90 = await readRows();
    const names = rows90.map((row) => row[0] ?? '');
    expect(names).not.toContain('架空 三太');
    expect(names).toHaveLength(3);
    for (const row of rows90) {
      expect.soft(Number(row[1]), `${row[0] ?? ''} の本数`).toBeGreaterThan(0);
    }
    // 名前の順で、本数の順ではない（本数は 3、3、7）。
    expect(names).toEqual(nameOrder.filter((name) => names.includes(name)));
    const counts = rows90.map((row) => Number(row[1]));
    expect(isDescending(counts), `本数の多い順ではない: ${counts.join(' ')}`).toBe(false);
    // 主文に人数を書かない（FR-51）。
    expect(await mainText(page)).not.toMatch(/\d+ 人/);
  });

  test('E-09: 伏せ値のセルは「—」と「伏せ値」で、一次も二次も同じクラスと文言', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    // S-01 直近 28 日: SNS の種類は x が一次、もう 1 つが二次で伏さる（null が 2 つ）。
    await openScreen(page, '/');
    const sns = tableByCaption(page, t('metric.M11.label'));
    const snsMasked = await sns
      .locator('tbody tr')
      .evaluateAll((rows) =>
        rows
          .filter((row) => row.querySelector('.masked') !== null)
          .map((row) => (row.children[0]?.textContent ?? '').trim()),
      );
    expect(snsMasked).toHaveLength(2);
    expect(snsMasked).toContain(t('sns.x'));
    // 一次と二次で、クラスも文言も同じ（見分けられない）。
    expect(await maskedShapes(page)).toHaveLength(1);
    expect((await maskedShapes(page))[0]).toMatch(new RegExp(`\\|${MASKED_TEXT}$`));
    // 曜日 × 時間帯も 2 マス（一次と二次）。
    await expect(page.locator('[data-part="heatmap-wide"] rect[data-level="masked"]')).toHaveCount(
      2,
    );
    // 図の中の伏せ値も同じ文言。
    const chartMasked = await page
      .locator('svg text[data-part="masked"]')
      .evaluateAll((texts) => [...new Set(texts.map((text) => text.textContent ?? ''))]);
    expect(chartMasked).toEqual([MASKED_TEXT]);

    // 直近 7 日: x だけが伏さる（二次なし）。
    await periodButton(page, 'last7').click();
    await expect(periodButton(page, 'last7')).toHaveAttribute('aria-pressed', 'true');
    const snsMasked7 = await sns
      .locator('tbody tr')
      .evaluateAll((rows) =>
        rows
          .filter((row) => row.querySelector('.masked') !== null)
          .map((row) => (row.children[0]?.textContent ?? '').trim()),
      );
    expect(snsMasked7).toEqual([t('sns.x')]);
    expect(await maskedShapes(page)).toHaveLength(1);

    // 直近 90 日: 地元の読者の目安は、国内その他と不明が伏さる。
    await periodButton(page, 'last90').click();
    await expect(periodButton(page, 'last90')).toHaveAttribute('aria-pressed', 'true');
    const local = tableByCaption(page, t('metric.M14.local.label'));
    const localMasked = await local
      .locator('tbody tr')
      .evaluateAll((rows) =>
        rows
          .filter((row) => row.querySelector('.masked') !== null)
          .map((row) => (row.children[0]?.textContent ?? '').trim()),
      );
    expect(localMasked.sort()).toEqual([t('local.japan_other'), t('local.unknown')].sort());

    // S-03（記事 111）: 最後まで読まれた割合が伏さる。S-05（author-a）: SNS が一次、直接が二次。
    for (const path of ['/articles/111', '/authors/author-a', '/articles/102']) {
      await openScreen(page, path);
      const shapes = await maskedShapes(page);
      expect.soft(shapes, `${path} の伏せ値の形は 1 種類`).toHaveLength(1);
      expect
        .soft(shapes[0] ?? '', `${path} の伏せ値の文言`)
        .toMatch(new RegExp(`\\|${MASKED_TEXT}$`));
    }
    await openScreen(page, '/authors/author-a');
    const channel = page.locator('table').filter({
      has: page.locator('caption', { hasText: '訪問回数（どこから来たか）' }),
    });
    const channelMasked = await channel
      .locator('tbody tr')
      .evaluateAll((rows) =>
        rows
          .filter((row) => row.querySelector('.masked') !== null)
          .map((row) => (row.children[0]?.textContent ?? '').trim()),
      );
    expect(channelMasked.sort()).toEqual([t('channel.social'), t('channel.direct')].sort());
    // 0 は伏せずに 0 と出る。
    const zeroRow = channel.locator('tbody tr').filter({ hasText: t('channel.other') });
    await expect(zeroRow.locator('td').first()).toHaveText('0');
  });

  test('E-09: セルと図に「5 回未満」の文言がない（説明は CommonNotes だけ）', async ({ page }) => {
    test.setTimeout(120_000);
    for (const screen of SCREENS) {
      await openScreen(page, screen.path);
      const cells = await page
        .locator('main td, main th, main svg text, main li, main p')
        .evaluateAll((elements) => elements.map((element) => element.textContent ?? ''));
      const withThreshold = cells.filter((text) => /\d\s*回未満|未満の小さな数/.test(text));
      expect.soft(withThreshold, `${screen.id} のセルの「回未満」`).toEqual([]);
    }
  });

  test('E-10: 読まれた回数が 19 の記事は割合が出ず、20 の記事は出る（S-03）', async ({ page }) => {
    const ratioLabel = t('metric.M09.label');
    // 記事 109: 直近 28 日の読まれた回数がちょうど 19。
    await openScreen(page, '/articles/109');
    let text = await mainText(page);
    expect(text).toContain('この期間に 19 回読まれました');
    let tail = text.slice(text.lastIndexOf(ratioLabel));
    expect(tail).toContain(t('absent.ratio20'));
    expect(tail).not.toMatch(/10 人中 \d+ 人\n/);

    // 記事 110: ちょうど 20。
    await openScreen(page, '/articles/110');
    text = await mainText(page);
    expect(text).toContain('この期間に 20 回読まれました');
    tail = text.slice(text.lastIndexOf(ratioLabel));
    expect(tail).not.toContain(t('absent.ratio20'));
    expect(tail).toMatch(/10 人中 \d+ 人/);
  });

  test('E-10: 分母が 20 未満の内訳と比較は、% を出さず数と差だけ', async ({ page }) => {
    // S-03（記事 101）: どこから来たかは訪問 25 回で % が出る。SNS の種類は 8 回で数だけ。
    await openScreen(page, '/articles/101');
    const text = await mainText(page);
    expect(text).toContain(t('lead.sessions', { n: 25 }));
    expect(text).toContain(t('lead.sessions', { n: 8 }));
    const snsStart = text.indexOf(t('lead.sessions', { n: 8 }));
    const snsPart = text.slice(snsStart, text.indexOf(t('metric.M12.label'), snsStart));
    expect(snsPart).toContain('Instagram');
    expect(snsPart).not.toContain('%');
    const channelPart = text.slice(text.indexOf(t('lead.sessions', { n: 25 })), snsStart);
    expect(channelPart).toMatch(/12（48%）/);

    // S-05（author-a）: 前の 28 日の読まれた回数は 19（記事 103 の公開日の分）。差だけが出る。
    await openScreen(page, '/authors/author-a');
    const summary = await page
      .getByText(/この期間に合計 [\d,]+ 回読まれました/)
      .first()
      .innerText();
    const match = /合計 ([\d,]+) 回読まれました（.*と比べて \+([\d,]+)）/.exec(summary);
    expect(match, summary).not.toBeNull();
    const total = Number((match?.[1] ?? '').replace(/,/g, ''));
    const diff = Number((match?.[2] ?? '').replace(/,/g, ''));
    expect(total - diff, '前の期間の読まれた回数（分母）').toBe(19);
    expect(summary).not.toContain('%');

    // S-01: 読まれた回数（分母が大きい）には % が付く。公開本数（前の期間は 7 本）は ▲▼ と差を
    // 付けず、前の期間の本数を並べる（助言 A-2）。
    await openScreen(page, '/');
    const kpi = await page.locator('[data-section="kpi"]').innerText();
    const pvPart = kpi.slice(0, kpi.indexOf(t('metric.M30.label')));
    const countPart = kpi.slice(
      kpi.indexOf(t('metric.M30.label')),
      kpi.indexOf(t('metric.M03.label')),
    );
    // 比率は「+8%」か、丸めて 0% のときの「ほぼ同じ」で出る（分母が 20 以上なので比率がある）。
    expect(pvPart).toMatch(new RegExp(`%|${t('compare.ratio.flat')}`));
    expect(countPart).toContain(t('compare.count.prevWindow', { days: 28, n: 7 }));
    expect(countPart).not.toMatch(/[▲▼]|[+−±]\d+/);
    expect(countPart).not.toContain('%');
  });

  // フィクスチャに、前の期間の値（比較の分母）がちょうど 20 になる場面がない。19 は author-a の
  // 前の 28 日（上の試験）。20 の側は Vitest の画面テスト（compare の分母 19 / 20）が確かめている。
  // フィクスチャに場面を足したら、ここを埋める。
  test.fixme('E-10: 前の期間の値がちょうど 20 のとき、差に % が付く（フィクスチャに場面がない）', () => {});

  test('E-15: S-04 に数字のセルがなく、slug は href にだけ現れる。S-05 の本文にも slug がない', async ({
    page,
  }) => {
    await openScreen(page, '/authors');
    const main = page.locator('main');
    await expect(main.locator('table')).toHaveCount(0);
    const links = main.locator('a[href^="/authors/"]');
    await expect(links).toHaveCount(4);
    const hrefs = await links.evaluateAll((anchors) =>
      anchors.map((anchor) => anchor.getAttribute('href') ?? ''),
    );
    expect([...hrefs].sort()).toEqual([
      '/authors/author-a',
      '/authors/author-b',
      '/authors/author-c',
      '/authors/author-d',
    ]);
    // 数字がどこにもない（本数も、読まれた回数も出さない）。
    const text = await mainText(page);
    expect(text).not.toMatch(/\d/);
    for (const item of await main.locator('li').allInnerTexts()) {
      expect.soft(item, 'S-04 の項目').not.toMatch(/\d/);
    }
    // slug は文字として出ない。
    expect(text).not.toMatch(/author-[a-d]/);
    const textNodes = await page.locator('body').evaluate((body) => {
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      const found: string[] = [];
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node.parentElement?.closest('script') !== null) continue;
        if (/author-[a-d]/.test(node.nodeValue ?? '')) found.push(node.nodeValue ?? '');
      }
      return found;
    });
    expect(textNodes).toEqual([]);

    // S-05: 本文、ページの題名、aria-label に slug がない。
    for (const slug of ['author-a', 'author-b', 'author-c', 'author-d']) {
      await openScreen(page, `/authors/${slug}`);
      const body = await page.locator('body').innerText();
      expect.soft(body, `${slug} の本文`).not.toContain(slug);
      expect.soft(await page.title(), `${slug} の題名`).not.toContain(slug);
      const labels = await page
        .locator('[aria-label], [title]')
        .evaluateAll((elements) =>
          elements.map(
            (element) =>
              `${element.getAttribute('aria-label') ?? ''} ${element.getAttribute('title') ?? ''}`,
          ),
        );
      expect
        .soft(
          labels.filter((label) => label.includes(slug)),
          `${slug} の aria-label`,
        )
        .toEqual([]);
    }
  });
});
