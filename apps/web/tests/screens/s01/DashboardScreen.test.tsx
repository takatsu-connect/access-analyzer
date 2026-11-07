import { fireEvent, render, screen, within } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';

import { buildDashboard } from '@/data/pages';
import { addDays } from '@/lib/derive';
import type { DashboardData, SiteBreakdown, SitePeriodValue } from '@/lib/page-data';
import { metricLabel, t } from '@/lib/ui-text';
import { DashboardScreen } from '@/screens/s01/DashboardScreen';

import { BUILT_AT, makeCache } from '../../data/fixture';

/** README の「使わない語」。 */
const FORBIDDEN_WORDS = [
  '偏り',
  '下位',
  '読まれなかった',
  '少ない',
  '悪い',
  '低い',
  'ランキング',
  '順位',
  'ワースト',
  'ベスト',
  'あなた',
];

function build(): DashboardData {
  return buildDashboard(makeCache(), BUILT_AT);
}

/** 直近 90 日を足したデータ（フィクスチャには 90 日の期間がない）。日別は 180 日分。 */
function buildWith90(): DashboardData {
  const data = build();
  const days = 180;
  const base = data.meta.baseDate;
  const firstDay = addDays(base, -(days - 1));
  const indexes = [...new Array<undefined>(days).keys()];
  return {
    ...data,
    daily: {
      firstDay,
      pageviews: indexes.map((index) => 100 + index),
      sessions: indexes.map((index) => 50 + index),
    },
    // 基準日の 9 日前（10 月 25 日）に 1 本公開。
    publishedPerDay: { firstDay, counts: indexes.map((index) => (index === days - 10 ? 1 : 0)) },
    periods: [
      ...data.periods,
      {
        id: 'last90',
        kind: 'window',
        start: addDays(base, -89),
        end: base,
        isConfirmed: false,
        label: t('period.last90'),
        prevId: 'prev90',
        yoyId: null,
      },
    ],
    sitePeriod: {
      ...data.sitePeriod,
      last90: {
        pageviews: 9000,
        sessions: 4500,
        activeUsers: 3000,
        engagementSeconds: 90000,
        days: 90,
      },
    },
  };
}

function siteOf(data: DashboardData, id: 'last7' | 'last28' | 'prev28'): SitePeriodValue {
  const site = data.sitePeriod[id];
  if (site === undefined) throw new Error(`フィクスチャに ${id} がありません`);
  return site;
}

function breakdownOf(data: DashboardData, id: 'last7'): SiteBreakdown {
  const breakdown = data.breakdown[id];
  if (breakdown === undefined) throw new Error(`フィクスチャに ${id} の内訳がありません`);
  return breakdown;
}

function renderScreen(data: DashboardData, search = ''): HTMLElement {
  window.history.replaceState(null, '', `/${search}`);
  return render(<DashboardScreen data={data} />).container;
}

function part(container: HTMLElement, selector: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(selector);
  if (element === null) throw new Error(`${selector} がありません`);
  return element;
}

/** 見出しを文字で探す（折りたたみの中の見出しにも使える）。 */
function headingByText(container: HTMLElement, tag: 'h3' | 'h4', text: string): HTMLElement {
  const heading = [...container.querySelectorAll<HTMLElement>(tag)].find(
    (element) => element.textContent === text,
  );
  if (heading === undefined) throw new Error(`見出し「${text}」がありません`);
  return heading;
}

/** KPI のカード（見出しの親）。 */
function kpiCard(container: HTMLElement, label: string): HTMLElement {
  const heading = within(part(container, '[data-section="kpi"]')).getByRole('heading', {
    name: label,
  });
  const card = heading.parentElement;
  if (card === null) throw new Error('カードがありません');
  return card;
}

function clickPeriod(key: 'period.last7' | 'period.last28' | 'period.last90'): void {
  fireEvent.click(screen.getByRole('button', { name: t(key) }));
}

function selectMonth(id: string): void {
  fireEvent.change(screen.getByLabelText(t('period.month')), { target: { value: id } });
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('S-01 全体ダッシュボード: 見出しと KPI', () => {
  it('h1 が問いの文言で、KPI が 3 枚ある', () => {
    const container = renderScreen(build());
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(t('s01.h1'));

    const headings = within(part(container, '[data-section="kpi"]')).getAllByRole('heading', {
      level: 2,
    });
    expect(headings.map((heading) => heading.textContent)).toEqual([
      t('metric.M01.label.first'),
      metricLabel('M30'),
      metricLabel('M03'),
    ]);
    expect(kpiCard(container, t('metric.M01.label.first')).textContent).toContain('3,100');
    expect(kpiCard(container, metricLabel('M30')).textContent).toContain('2');
  });

  it('読んだ人の数が伏せ値のときは「—」と「伏せ値」', () => {
    const container = renderScreen(build(), '?p=m2026-11');
    const card = kpiCard(container, metricLabel('M03'));
    const mark = card.querySelector('.masked');
    expect(mark?.textContent).toBe(`${t('masked.dash')}${t('masked.label')}`);
    expect(mark?.querySelector('small')?.textContent).toBe('伏せ値');
  });

  it('前の期間の値が 19 のときは差だけで、% を出さない', () => {
    const data = build();
    siteOf(data, 'prev28').pageviews = 19;
    const container = renderScreen(data);
    const line = part(kpiCard(container, t('metric.M01.label.first')), '[data-compare="prev"]');
    expect(line.textContent).toContain(t('compare.prevWindow', { days: 28 }));
    expect(line.textContent).toContain('+3,081');
    expect(line.textContent).not.toContain('%');
  });

  it('前の期間の値が 20 のときは % も出す', () => {
    const data = build();
    siteOf(data, 'last28').pageviews = 30;
    siteOf(data, 'prev28').pageviews = 20;
    const container = renderScreen(data);
    const line = part(kpiCard(container, t('metric.M01.label.first')), '[data-compare="prev"]');
    expect(line.textContent).toContain('+10（+50%）');
  });

  it('+100% 以上は倍で書く（3,100 と 20 は「約 155 倍」）', () => {
    const data = build();
    siteOf(data, 'prev28').pageviews = 20;
    const container = renderScreen(data);
    const line = part(kpiCard(container, t('metric.M01.label.first')), '[data-compare="prev"]');
    expect(line.textContent).toContain('+3,080（約 155 倍）');
    expect(line.textContent).not.toContain('%');
  });

  it('期間を切り替えると KPI の値が変わる', () => {
    const container = renderScreen(build());
    const label = t('metric.M01.label.first');
    expect(kpiCard(container, label).textContent).toContain('3,100');

    clickPeriod('period.last7');
    expect(kpiCard(container, label).textContent).toContain('800');
    expect(kpiCard(container, label).textContent).not.toContain('3,100');
    expect(window.location.search).toBe('?p=last7');
  });

  it('月を選ぶと、去年の同じ月の行が並ぶ。相手が数え始めた月（2025-10、8 日から）なら差を出さず数字を並べる', () => {
    const container = renderScreen(build());
    const label = t('metric.M01.label.first');
    expect(kpiCard(container, label).querySelector('[data-compare="yoy"]')).toBeNull();

    selectMonth('m2026-10');
    const line = part(kpiCard(container, label), '[data-compare="yoy"]');
    expect(line.textContent).toBe('去年の同じ月は 2,000（8 日からの数字）');
    expect(line.textContent).not.toMatch(/[▲▼%]/);
    // 公開本数は ▲▼ と差を付けず、去年の同じ月の本数を並べる（助言 A-2）。
    const posting = part(kpiCard(container, metricLabel('M30')), '[data-compare="yoy"]');
    expect(posting.textContent).toBe('去年の同じ月は 0 本');
  });

  it('公開した記事の本数は ▲▼ と差を付けず「前の 28 日は 7 本」。月は「前の月は … 本」', () => {
    const data = build();
    const container = renderScreen({
      ...data,
      posting: {
        ...data.posting,
        last28: { postCount: 2 },
        prev28: { postCount: 7 },
        'm2026-09': { postCount: 3 },
      },
      // 前の月（9 月）の本数を引けるように、10 月の比較の相手を 9 月にする。
      periods: data.periods.map((period) =>
        period.id === 'm2026-10' ? { ...period, prevId: 'm2026-09' as const } : period,
      ),
    });
    const card = kpiCard(container, metricLabel('M30'));
    expect(part(card, '[data-compare="prev"]').textContent).toBe('前の 28 日は 7 本');
    expect(card.textContent).not.toMatch(/[▲▼]/);
    expect(card.textContent).not.toContain('−5');
    // 読まれた回数の比較は、今のまま ▲▼ と差。
    expect(kpiCard(container, t('metric.M01.label.first')).textContent).toMatch(/[▲▼]/);

    selectMonth('m2026-10');
    expect(part(kpiCard(container, metricLabel('M30')), '[data-compare="prev"]').textContent).toBe(
      '前の月は 3 本',
    );
  });

  it('終わった月（集計中）で、去年の同じ月が数え始めた月でなければ、差と % を出す', () => {
    const data = build();
    const container = renderScreen({
      ...data,
      meta: { ...data.meta, measureStart: '2025-10-01' },
    });
    selectMonth('m2026-10');
    const line = part(kpiCard(container, t('metric.M01.label.first')), '[data-compare="yoy"]');
    expect(line.textContent).toContain(t('compare.yoy'));
    expect(line.textContent).toContain('+1,500');
    expect(line.textContent).toContain('+75%');
  });

  it('去年の同じ月の数字がない月は「去年の同じ月の数字なし」', () => {
    const data = build();
    const sitePeriod = { ...data.sitePeriod };
    delete sitePeriod['m2025-10'];
    const container = renderScreen({ ...data, sitePeriod });
    selectMonth('m2026-10');
    const line = part(kpiCard(container, t('metric.M01.label.first')), '[data-compare="yoy"]');
    expect(line.textContent).toBe('去年の同じ月の数字なし');
  });

  it('月の途中（2026 年 11 月、未確定）は ▲▼ と % を出さず、「月が終わると…」を出す', () => {
    const container = renderScreen(build());
    selectMonth('m2026-11');
    const kpi = part(container, '[data-section="kpi"]');
    const prevLines = [...kpi.querySelectorAll('[data-compare="prev"]')].map(
      (line) => line.textContent,
    );
    const yoyLines = [...kpi.querySelectorAll('[data-compare="yoy"]')].map(
      (line) => line.textContent,
    );
    expect(prevLines.length).toBe(3);
    for (const line of prevLines) expect(line).toBe(t('compare.inProgress'));
    for (const line of yoyLines) expect(line).toBe(t('compare.inProgress.yoy'));
    expect(kpi.textContent).not.toMatch(/[▲▼%]/);
  });

  it('読まれていた時間: 前の期間はあるが読まれた回数が 20 未満なら、その理由を書く', () => {
    const data = build();
    siteOf(data, 'prev28').pageviews = 19;
    const container = renderScreen(data);
    const card = headingByText(container, 'h3', metricLabel('M06')).parentElement;
    expect(card?.textContent).toContain(t('s01.engagement.prev.ratio20'));
    expect(card?.textContent).not.toContain(t('absent.prev'));
  });

  it('帯の 1 文を出し、benchmark30 が null のときは「まだ比較できません」', () => {
    const data = build();
    const container = renderScreen(data);
    expect(part(container, '[data-part="benchmark"]').textContent).toBe(
      t('s01.benchmark', { p25: '100', p50: '200', p75: '300' }),
    );

    const noBand = renderScreen({ ...data, benchmark30: null });
    expect(part(noBand, '[data-part="benchmark"]').textContent).toBe('まだ比較できません');
  });

  it('読まれていた時間は、読まれた回数が 20 未満のとき比率を出さない', () => {
    const data = build();
    const container = renderScreen(data);
    // 36,000 秒 ÷ 3,100 回 = 11.6 秒。
    expect(headingByText(container, 'h3', metricLabel('M06')).parentElement?.textContent).toContain(
      '12 秒',
    );
    expect(container.textContent).not.toContain(t('absent.ratio20'));

    const few = build();
    siteOf(few, 'last28').pageviews = 19;
    const fewContainer = renderScreen(few);
    expect(fewContainer.textContent).toContain(t('absent.ratio20'));
  });

  it('期間の数字がないときは、節を出さずに「この期間の数字はまだありません。」', () => {
    const data = build();
    const sitePeriod = { ...data.sitePeriod };
    delete sitePeriod.last28;
    const container = renderScreen({ ...data, sitePeriod });
    expect(container.textContent).toContain(t('state.empty'));
    expect(container.querySelector('[data-section]')).toBeNull();
    expect(screen.getByRole('heading', { level: 1 })).toBeDefined();
  });
});

describe('S-01 全体ダッシュボード: 日ごとの図', () => {
  it('切り替えは「読まれた回数」「訪問回数」の 2 つだけ', () => {
    const container = renderScreen(build());
    const daily = part(container, '[data-section="daily"]');
    const group = within(daily).getByRole('group', { name: t('s01.daily.metric.aria') });
    const buttons = within(group).getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual(['読まれた回数', '訪問回数']);
    expect(buttons[0]?.getAttribute('aria-pressed')).toBe('true');
    // 直近 28 日には、週別と日別の切り替えがない。
    expect(within(daily).queryByRole('group', { name: t('s01.daily.grain.aria') })).toBeNull();
  });

  it('前の期間の線があり、固定行は最新の確定日から始まる', () => {
    const container = renderScreen(build());
    const daily = part(container, '[data-section="daily"]');
    // 図の凡例（span）に「前の期間」がある。表の見出し（th）とは別に数える。
    const legends = within(daily)
      .getAllByText(t('legend.prev'))
      .filter((element) => element.tagName === 'SPAN');
    expect(legends).toHaveLength(1);
    // 図の下に、同じ値の表がある（28 日分）。
    expect(daily.querySelectorAll('tbody tr')).toHaveLength(28);
    // 基準日 11 月 3 日 → 最新の確定日は 10 月 31 日。前の期間の同じ日は 28 日前の 10 月 3 日。
    expect(part(daily, '[data-part="fixed-row"]').textContent).toBe(
      t('chart.fixedRow', {
        date: '10 月 31 日',
        label: metricLabel('M01'),
        value: '130',
        prev: '102',
      }),
    );
  });

  it('訪問回数に切り替えると、図と URL が変わる', () => {
    const container = renderScreen(build());
    const daily = part(container, '[data-section="daily"]');
    fireEvent.click(within(daily).getByRole('button', { name: metricLabel('M02') }));
    expect(part(daily, '[data-part="fixed-row"]').textContent).toContain(
      `${metricLabel('M02')} 80`,
    );
    expect(window.location.search).toBe('?line=sessions');
  });

  it('90 日を選ぶと週別が既定で、日別に切り替えられる', () => {
    const container = renderScreen(buildWith90());
    clickPeriod('period.last90');
    const daily = part(container, '[data-section="daily"]');
    const group = within(daily).getByRole('group', { name: t('s01.daily.grain.aria') });
    // S-03 とそろえた語と順（日ごと / 週ごと）。
    expect(
      within(group)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['日ごと', '週ごと']);
    expect(t('s01.daily.grain.aria')).toBe('グラフのまとめ方');
    const week = within(group).getByRole('button', { name: '週ごと' });
    const day = within(group).getByRole('button', { name: '日ごと' });
    expect(week.getAttribute('aria-pressed')).toBe('true');
    // 90 日を 7 日ずつにまとめると 13 個の点になる。
    expect(daily.querySelectorAll('[data-part="hit"]')).toHaveLength(13);
    expect(daily.querySelectorAll('tbody tr')).toHaveLength(13);
    // 週別の既定は、あとで増える日を含まない最後の週（LineChart の決まり）。
    // その週に、10 月 25 日の公開 1 本が入る。
    expect(part(daily, '[data-part="fixed-row"]').textContent).toBe(
      '10 月 22 日〜10 月 28 日: 読まれた回数 1,890（前の期間の同じ週: 1,260）。この週に 1 本公開',
    );

    fireEvent.click(day);
    expect(day.getAttribute('aria-pressed')).toBe('true');
    expect(daily.querySelectorAll('[data-part="hit"]')).toHaveLength(90);
    expect(daily.querySelectorAll('tbody tr')).toHaveLength(90);
    expect(part(daily, '[data-part="fixed-row"]').textContent).toContain('前の期間の同じ日');
    // 週別と日別の切り替えは URL に持たない。
    expect(window.location.search).toBe('?p=last90');
  });
});

describe('S-01 全体ダッシュボード: 読者はどこから来たか', () => {
  it('流入チャネルの図の前に「訪問 ◯回のうち」がある', () => {
    const container = renderScreen(build(), '?p=last7');
    const channel = part(container, '[data-section="source"] [data-part="channel"]');
    const lead = part(channel, '[data-part="lead"]');
    const figure = part(channel, 'svg[role="img"]');
    expect(lead.textContent).toBe('訪問 400 回のうち');
    expect(lead.compareDocumentPosition(figure) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(part(channel, 'g[data-key="search"]').querySelector('[data-part="bar"]')).not.toBeNull();
  });

  it('伏せ値の区分は棒がなく「— 伏せ値」', () => {
    const container = renderScreen(build(), '?p=last7');
    const row = part(container, '[data-part="channel"] g[data-key="referral"]');
    expect(row.querySelector('[data-part="bar"]')).toBeNull();
    const masked = part(row, '[data-part="masked"]');
    expect(masked.textContent).toContain('—');
    expect(masked.textContent).toContain('伏せ値');
  });

  it('SNS の種類の前置きは、流入チャネルの SNS の値', () => {
    const container = renderScreen(build(), '?p=last7');
    const sns = part(container, '[data-part="sns"]');
    expect(part(sns, '[data-part="lead"]').textContent).toBe('訪問 100 回のうち');
    expect(part(sns, 'g[data-key="instagram"]').querySelector('[data-part="bar"]')).not.toBeNull();
  });

  it('流入チャネルの SNS が伏せ値のときは、前置きも比率も出さない', () => {
    const data = build();
    breakdownOf(data, 'last7').channel.social = null;
    const container = renderScreen(data, '?p=last7');
    const sns = part(container, '[data-part="sns"]');
    expect(sns.querySelector('[data-part="lead"]')).toBeNull();
    expect(sns.querySelector('[data-part="bar"]')).toBeNull();
    expect(part(sns, 'g[data-key="instagram"]').textContent).not.toContain('%');
  });

  it('リンク元と市別の表は、期間を変えても値が変わらず、見出しに月の名前がある', () => {
    const container = renderScreen(build());
    const referrer = part(container, '[data-part="referrer"]');
    const region = part(container, '[data-part="region"]');
    const tableText = (root: HTMLElement): string => part(root, 'table').textContent ?? '';
    const cityTable = (): string => {
      const tables = region.querySelectorAll('table');
      return tables[tables.length - 1]?.textContent ?? '';
    };

    const referrerBefore = tableText(referrer);
    const cityBefore = cityTable();
    expect(referrerBefore).toContain('google.com');
    expect(referrerBefore).toContain('500');
    expect(referrerBefore).toContain('instagram.com');
    expect(cityBefore).toContain('川崎市');
    expect(cityBefore).toContain('300');
    // 見出し「リンク元のサイト（2026 年 10 月）」と、その直下の注記。
    expect(headingByText(container, 'h3', `${metricLabel('M12')}（2026 年 10 月）`)).toBeDefined();
    const cityHeading = headingByText(container, 'h4', '市別（2026 年 10 月）');
    expect(cityHeading.nextElementSibling?.textContent).toBe(t('s01.monthly.note'));
    expect(t('s01.monthly.note')).toBe(
      '月ごとに集計しています。上で期間を選び直しても変わりません。',
    );
    expect(within(referrer).getByText(t('s01.monthly.note'))).toBeDefined();
    expect(container.textContent).not.toContain('前月までの集計');

    clickPeriod('period.last7');
    expect(tableText(referrer)).toBe(referrerBefore);
    expect(cityTable()).toBe(cityBefore);
  });

  it('確定した月を選ぶと、その月の表になる', () => {
    const container = renderScreen(build());
    selectMonth('m2026-10');
    const referrer = part(container, '[data-part="referrer"]');
    expect(headingByText(container, 'h3', `${metricLabel('M12')}（2026 年 10 月）`)).toBeDefined();
    // 比べる月の表そのものがない（9 月、去年の 10 月）ので、差の数は出さず、文字で書く。
    expect(within(referrer).getAllByText(t('s01.monthly.noPrev')).length).toBeGreaterThan(0);
    expect(within(referrer).getAllByText(t('absent.yoy')).length).toBeGreaterThan(0);
  });

  it('比べる月の表はあるがその行がない（上位 10 の外）ときは「前の月は表にありません」', () => {
    const data = build();
    const container = renderScreen({
      ...data,
      periods: data.periods.map((period) =>
        period.id === 'm2026-10' ? { ...period, prevId: 'm2026-09' as const } : period,
      ),
      monthReferrer: {
        ...data.monthReferrer,
        'm2026-09': [{ domain: 'google.com', sessions: 400 }],
      },
    });
    selectMonth('m2026-10');
    const referrer = part(container, '[data-part="referrer"]');
    const rowOf = (name: string): string =>
      [...referrer.querySelectorAll('tbody tr')].find((row) =>
        (row.textContent ?? '').includes(name),
      )?.textContent ?? '';
    expect(rowOf('google.com')).toContain('+100');
    expect(rowOf('instagram.com')).toContain('前の月は表にありません');
    expect(rowOf('instagram.com')).not.toContain(t('s01.monthly.noPrev'));
  });

  it('月の表の「詳しく」は折り返さない（360px で「詳し / く」にならない）', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync('src/screens/s01/s01.module.css', 'utf8');
    expect(css).toMatch(/\.narrowCell summary\s*\{\s*white-space: nowrap;/);
  });
});

describe('S-01 全体ダッシュボード: 読者はどんな人？', () => {
  it('折りたたみ（details）の中にある', () => {
    renderScreen(build(), '?p=last7');
    const heading = screen.getByRole('heading', { level: 2, name: t('s01.readers.h2') });
    const details = heading.closest('details');
    expect(details).not.toBeNull();
    expect(heading.closest('summary')).not.toBeNull();
    expect(details?.querySelector('[data-part="heatmap"]')).not.toBeNull();
    expect(details?.querySelector('[data-part="device"]')).not.toBeNull();
    expect(details?.querySelector('[data-part="region"]')).not.toBeNull();
    expect(details?.querySelector('[data-part="new-returning"]')).not.toBeNull();
  });

  it('端末の 2 つ目の図（訪問回数）は、title に指標名がある', () => {
    const container = renderScreen(build(), '?p=last7');
    const device = part(container, '[data-part="device"]');
    const titles = [...device.querySelectorAll('svg title')].map((title) => title.textContent);
    expect(titles).toContain(t('s01.device.h3'));
    expect(titles).toContain('どんな端末で読まれたか（訪問回数）');
  });

  it('期間の日数が 0 のときは、ヒートマップの切り替えを出さない', () => {
    const data = build();
    siteOf(data, 'last7').days = 0;
    const container = renderScreen(data, '?p=last7');
    const heatmap = part(container, '[data-part="heatmap"]');
    expect(within(heatmap).queryByRole('group', { name: t('s01.heat.mode.aria') })).toBeNull();
  });

  it('ヒートマップは 1 日あたりの平均が既定で、合計に切り替えられる', () => {
    const container = renderScreen(build(), '?p=last7');
    const wide = part(container, '[data-part="heatmap-wide"]');
    const label = (mode: 'heat.avg' | 'heat.sum'): string =>
      t('s01.heat.label', { metric: metricLabel('M01'), mode: t(mode) });
    // 土曜 23 時の 9 回 ÷ 7 日 = 1.3。
    expect(part(wide, '[data-part="fixed-row"]').textContent).toBe(
      t('heatmap.fixedRow', { row: '土曜', col: '23 時', label: label('heat.avg'), value: '1.3' }),
    );
    // 狭い画面用の 7 × 6 と、それぞれの図と同じ値の表（1 マス 1 行）。
    const narrow = part(container, '[data-part="heatmap-narrow"]');
    expect(wide.querySelectorAll('tbody tr')).toHaveLength(7 * 24);
    expect(narrow.querySelectorAll('tbody tr')).toHaveLength(7 * 6);
    // 日曜 1 時は伏せ値。それを含む区分（深夜 0〜3 時）も伏せ値になる。
    const firstSlot = narrow.querySelector('tbody tr');
    expect(firstSlot?.textContent).toContain('日曜');
    expect(firstSlot?.textContent).toContain('深夜 0〜3 時');
    expect(firstSlot?.querySelector('.masked')?.textContent).toBe('—伏せ値');
    expect(wide.querySelector('tbody tr')?.textContent).toContain('0.7');

    // 折りたたみの中なので、役割ではなく文字で探す。
    fireEvent.click(within(container).getByText(t('heat.sum')));
    expect(
      part(part(container, '[data-part="heatmap-wide"]'), '[data-part="fixed-row"]').textContent,
    ).toBe(
      t('heatmap.fixedRow', { row: '土曜', col: '23 時', label: label('heat.sum'), value: '9' }),
    );
    expect(window.location.search).toBe('?p=last7&heat=sum');
  });

  it('読んだ人の数が伏せ値のときは、初めての人とまた来た人の前置きを出さない', () => {
    const data = build();
    const container = renderScreen(data, '?p=last7');
    expect(part(container, '[data-part="new-returning"] [data-part="lead"]').textContent).toBe(
      '読んだ人 300 人のうち',
    );

    const masked = build();
    siteOf(masked, 'last7').activeUsers = null;
    const maskedContainer = renderScreen(masked, '?p=last7');
    const block = part(maskedContainer, '[data-part="new-returning"]');
    expect(block.querySelector('[data-part="lead"]')).toBeNull();
    expect(block.querySelector('[data-part="bar"]')).toBeNull();
  });
});

describe('S-01 全体ダッシュボード: 出力の決まり', () => {
  it.each(['', '?p=last7', '?p=m2026-10', '?p=m2026-11'])(
    'style 属性がなく、使わない語と「鮮度」が本文にない（%s）',
    (search) => {
      const container = renderScreen(buildWith90(), search);
      expect(container.querySelectorAll('[style]')).toHaveLength(0);
      const text = container.textContent ?? '';
      for (const word of [...FORBIDDEN_WORDS, '鮮度']) {
        expect(text, word).not.toContain(word);
      }
      expect(text).not.toMatch(/出ません/);
    },
  );

  it('静的な HTML は、URL に依らず既定の期間（直近 28 日）で、style 属性がない', () => {
    window.history.replaceState(null, '', '/?p=last7&line=sessions');
    const html = renderToStaticMarkup(<DashboardScreen data={build()} />);
    expect(html).not.toMatch(/\sstyle=/);
    expect(html).toContain(t('s01.h1'));
    // 直近 28 日の読まれた回数（3,100）。直近 7 日の値（800）は KPI に出ない。
    expect(html).toContain('>3,100<');
    expect(html).not.toContain('>800<');
  });
});
