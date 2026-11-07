import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';

import { buildArticleDetail } from '@/data/pages';
import type { ArticleDetailData, ArticlePeriodValue, Period } from '@/lib/page-data';
import { ArticleDetailScreen } from '@/screens/s03/ArticleDetailScreen';

import { BUILT_AT, makeCache, SATO, TANAKA } from '../../data/fixture';

// フィクスチャ（tests/data/fixture.ts）の記事:
// 101 = 数え始める前に公開、102 = 293 日目（節目 2 つ、リンク元あり、著者の記事 5 本）、
// 103 = 25 日目、104 = 3 日目（著者の記事 2 本、リンク元は未経過）。日数は公開した日を 1 日目と数える。

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

function detail(postId: number): ArticleDetailData {
  const data = buildArticleDetail(makeCache(), postId, BUILT_AT);
  if (data === null) throw new Error(`フィクスチャに記事 ${postId} がありません`);
  return data;
}

function show(data: ArticleDetailData): HTMLElement {
  return render(<ArticleDetailScreen data={data} />).container;
}

function all(root: Element, selector: string): Element[] {
  return [...root.querySelectorAll(selector)];
}

function sectionOf(container: HTMLElement, id: string): HTMLElement {
  const node = container.querySelector<HTMLElement>(`section[aria-labelledby="${id}"]`);
  if (node === null) throw new Error(`節がありません: ${id}`);
  return node;
}

function textOf(node: Element | null | undefined): string {
  return node?.textContent ?? '';
}

function headings(container: HTMLElement, tag: 'h1' | 'h2' | 'h3'): string[] {
  return all(container, tag).map((node) => textOf(node));
}

function button(container: HTMLElement, name: string): Element {
  const found = all(container, 'button').find((node) => textOf(node) === name);
  if (found === undefined) throw new Error(`ボタンがありません: ${name}`);
  return found;
}

/** 同じ値を並べた配列（帯の 90 日分など）。 */
function filled(length: number, value: number): number[] {
  return new Array<number>(length).fill(value);
}

/** 直近 28 日の値だけを差し替える。 */
function withLast28(data: ArticleDetailData, value: ArticlePeriodValue): ArticleDetailData {
  return { ...data, period: { ...data.period, last28: value } };
}

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('S-03 記事詳細: 見出しと節の順', () => {
  it('h1 は問いの形で、節は期間に依らないものが先に並ぶ', () => {
    const container = show(detail(102));
    expect(headings(container, 'h1')).toEqual(['この記事はどう読まれた？']);
    expect(headings(container, 'h2')).toEqual([
      '公開からの読まれ方',
      '到達のお知らせ',
      'さとう はなこさんのこれまでの記事と比べて',
      'この期間に読まれた回数',
      '日ごとの読まれた回数',
      '読者はどこから来たか',
      'どんな端末で読まれたか',
      'どれくらい読み込まれたか（目安）',
    ]);
  });

  it('PeriodPicker は「これまでの記事と比べて」の下、「この期間に読まれた回数」の上にある', () => {
    const container = show(detail(102));
    const picker = container.querySelector('[role="group"][aria-label="期間"]');
    const own = container.querySelector('#s03-own');
    const period = container.querySelector('#s03-period');
    if (picker === null || own === null || period === null) throw new Error('要素がありません');
    expect(own.compareDocumentPosition(picker) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(picker.compareDocumentPosition(period) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(textOf(container)).toContain('ここから下は、選んだ期間の数字です');
  });

  it('属性の行に、タイトル、著者、公開日と日数、鮮度の名称、カテゴリ、シリーズが出る', () => {
    const text = textOf(show(detail(102)));
    expect(text).toContain('記事 102');
    expect(text).toContain('さとう はなこ');
    expect(text).toContain('公開日 2026 年 1 月 15 日（293 日目）');
    expect(text).toContain('3 か月より前');
    expect(text).toContain('カテゴリ: 記事 > グルメ');
    expect(text).toContain('シリーズ: さんぽ');
  });
});

describe('S-03 記事詳細: 前の期間と比べない', () => {
  it('▲▼ と「前の 28 日と比べて」がなく、「公開からの合計は」がある', () => {
    const text = textOf(show(detail(102)));
    expect(text).not.toContain('▲');
    expect(text).not.toContain('▼');
    expect(text).not.toContain('前の 28 日と比べて');
    expect(text).toContain('この期間に 30 回読まれました。公開からの合計は 2,100 回です。');
  });

  it('日ごとの図に前の期間の線がなく、固定行は最新の確定日から始まる', () => {
    const daily = sectionOf(show(detail(102)), 's03-daily');
    expect(daily.querySelector('[data-series="prev"]')).toBeNull();
    expect(daily.querySelector('[data-series="current"]')).not.toBeNull();
    expect(textOf(daily)).not.toContain('前の期間');
    const fixedRow = textOf(daily.querySelector('[data-part="fixed-row"]'));
    expect(fixedRow).toContain('10 月 31 日');
    expect(fixedRow).toContain('読まれた回数');
  });

  it('図の下に、同じ値の表がある（公開からの読まれ方、日ごと）', () => {
    const container = show(detail(102));
    const curveTable = textOf(sectionOf(container, 's03-curve').querySelector('details table'));
    expect(curveTable).toContain('1 日目');
    expect(curveTable).toContain('45');
    const dailyTable = textOf(sectionOf(container, 's03-daily').querySelector('details table'));
    expect(dailyTable).toContain('2026 年 11 月 3 日');
    expect(dailyTable).toContain('あとで増えることがあります');
  });
});

describe('S-03 記事詳細: 公開からの読まれ方', () => {
  it('30 日以上たった記事は、30 日の回数と帯の範囲を書く', () => {
    const text = textOf(sectionOf(show(detail(102)), 's03-curve'));
    expect(text).toContain(
      '30 日で 400 回読まれました。多くの記事は 100〜300 回（真ん中は 200 回）です。',
    );
    expect(text).toContain('公開した日を 1 日目として数えます。');
    expect(text).toContain('成績ではなく、位置です。');
  });

  it('30 日未満の記事は「◯日目で ◯回」の文になる', () => {
    const data: ArticleDetailData = {
      ...detail(103),
      cumulative: filled(90, 0).map((_, index) => (index < 25 ? (index + 1) * 4 : null)),
      benchmark: {
        p25: filled(90, 40),
        p50: filled(90, 80),
        p75: filled(90, 150),
        populationSize: 40,
        populationWindow: '2025-11-03/2026-11-03',
      },
      ownMedian30d: { value: 110 },
    };
    const container = show(data);
    expect(textOf(sectionOf(container, 's03-curve'))).toContain(
      '25 日目で 100 回読まれました。同じ 25 日目の多くの記事は 40〜150 回です。',
    );
    expect(textOf(sectionOf(container, 's03-own'))).toContain(
      'たなか たろうさんのこれまでの記事は、30 日で 110 回くらい読まれています。この記事は 25 日目で 100 回。',
    );
  });

  it('3 日未満の記事は「まだ比較できません」', () => {
    const text = textOf(sectionOf(show(detail(104)), 's03-curve'));
    expect(text).toContain('まだ比較できません');
    expect(text).not.toContain('日目で');
  });
});

describe('S-03 記事詳細: 到達のお知らせ', () => {
  it('節目を回数の順に、到達日つきで出す', () => {
    const text = textOf(sectionOf(show(detail(102)), 's03-milestone'));
    const first = text.indexOf('500 回読まれました（2026 年 2 月 1 日）');
    const second = text.indexOf('1,000 回読まれました（2026 年 3 月 1 日）');
    expect(first).toBeGreaterThanOrEqual(0);
    expect(second).toBeGreaterThan(first);
    expect(text).not.toContain('数え始めてから');
  });

  it('到達がないときは、最初のお知らせがいつ出るかを書く', () => {
    const text = textOf(sectionOf(show(detail(104)), 's03-milestone'));
    expect(text).toContain('500 回読まれると、最初のお知らせが出ます');
  });
});

describe('S-03 記事詳細: ◯◯さんのこれまでの記事と比べて', () => {
  it('30 日たった記事は、著者自身の過去の記事と比べる', () => {
    const text = textOf(sectionOf(show(detail(102)), 's03-own'));
    expect(text).toContain(
      'さとう はなこさんのこれまでの記事は、30 日で 230 回くらい読まれています。この記事は 30 日で 400 回。',
    );
    // 範囲はバッチの定義（直近 365 日に公開し、30 日たった記事）と同じ言い方。
    expect(text).toContain('直近 1 年に公開し、30 日たった記事（広告を除く）で見ています。');
  });

  it('著者の記事が 5 本未満のときは、不在の文を出す', () => {
    const text = textOf(sectionOf(show(detail(104)), 's03-own'));
    expect(text).toContain('直近 1 年に公開して 30 日たった記事が 5 本以上になると出ます');
    expect(text).not.toContain('くらい読まれています');
  });
});

describe('S-03 記事詳細: 読者はどこから来たか', () => {
  it('リンク元がまだ計算されていないときは「公開から 30 日たつと出ます」', () => {
    const text = textOf(sectionOf(show(detail(104)), 's03-source'));
    expect(text).toContain('公開から 30 日たつと出ます');
    expect(text).toContain('公開から 30 日間の集計です。期間を選び直しても変わりません。');
  });

  it('リンク元の表は、期間を変えても変わらない', async () => {
    const container = show(detail(102));
    const referrerTable = (): string =>
      textOf(
        all(sectionOf(container, 's03-source'), 'table').find((node) =>
          textOf(node).includes('google.com'),
        ),
      );
    const before = referrerTable();
    expect(before).toContain('google.com30');
    expect(before).toContain('instagram.com12');
    expect(textOf(sectionOf(container, 's03-source'))).toContain('公開から 30 日間の集計です');

    fireEvent.click(button(container, '直近 7 日'));
    await waitFor(() => {
      expect(textOf(sectionOf(container, 's03-period'))).toContain('この期間に 5 回読まれました');
    });
    expect(referrerTable()).toBe(before);
    expect(textOf(sectionOf(container, 's03-source'))).toContain('公開から 30 日間の集計です');
  });

  it('前置きは「この記事から読み始めた訪問」の数で、伏せ値の区分は「— 伏せ値」と書く', () => {
    const source = sectionOf(show(detail(102)), 's03-source');
    expect(textOf(source)).toContain('この記事から読み始めた訪問 30 回のうち');
    expect(textOf(source)).toContain('— 伏せ値');
    expect(source.querySelectorAll('.masked').length).toBeGreaterThan(0);
  });

  it('訪問回数が伏せ値のときは、前置きを出さない', async () => {
    const container = show(detail(104));
    fireEvent.click(button(container, '直近 7 日'));
    await waitFor(() => {
      expect(textOf(sectionOf(container, 's03-period'))).toContain('この期間に 12 回読まれました');
    });
    expect(textOf(sectionOf(container, 's03-source'))).not.toContain('回のうち');
    expect(textOf(sectionOf(container, 's03-device'))).not.toContain('回のうち');
  });
});

describe('S-03 記事詳細: どんな端末で読まれたか', () => {
  it('前置きと分母を「この記事から読み始めた訪問」にそろえる', () => {
    const text = textOf(sectionOf(show(detail(102)), 's03-device'));
    expect(text).toContain('この記事から読み始めた訪問 30 回のうち');
    expect(text).not.toContain('読まれた 30 回のうち');
    // 前置きの注記は、最初に出る節（読者はどこから来たか）にだけ。
    expect(text).not.toContain('ほかのページから移ってきて');
    // 22 ÷ 30 = 73%。
    expect(text).toContain('73%');
  });
});

describe('S-03 記事詳細: どれくらい読み込まれたか（目安）', () => {
  it('読まれた回数が 19 回のときは、不在の文を出す', () => {
    const data = withLast28(detail(102), {
      pageviews: 19,
      landingSessions: 19,
      scrollCount: 10,
      engagementSeconds: 570,
    });
    const text = textOf(sectionOf(show(data), 's03-engagement'));
    expect(text.split('読まれた回数が 20 回以上になると出ます').length - 1).toBe(2);
    // 注記の例（「10 人中 6 人」）は残る。値（10 人中 5 人、30 秒）は出さない。
    expect(text).not.toContain('10 人中 5 人');
    expect(text).not.toContain('30 秒');
  });

  it('読まれた回数が 20 回のときは、値を出す', () => {
    const data = withLast28(detail(102), {
      pageviews: 20,
      landingSessions: 20,
      scrollCount: 10,
      engagementSeconds: 600,
    });
    const text = textOf(sectionOf(show(data), 's03-engagement'));
    expect(text).toContain('30 秒');
    expect(text).toContain('10 人中 5 人');
    expect(text).not.toContain('20 回以上になると出ます');
  });

  it('分子が伏せ値のときは、伏せ値の印を出す', () => {
    const data = withLast28(detail(102), {
      pageviews: 40,
      landingSessions: 40,
      scrollCount: null,
      engagementSeconds: null,
    });
    const section = sectionOf(show(data), 's03-engagement');
    expect(section.querySelectorAll('.masked').length).toBe(2);
    expect(textOf(section)).toContain('伏せ値');
  });
});

describe('S-03 記事詳細: 数え始める前に公開した記事', () => {
  it('3 つの節を見出しごと出さず、冒頭の 1 文と、日付つきの合計の文を出す', () => {
    const container = show(detail(101));
    const text = textOf(container);
    const h2 = headings(container, 'h2');
    expect(h2).not.toContain('公開からの読まれ方');
    expect(h2.some((heading) => heading.includes('これまでの記事と比べて'))).toBe(false);
    expect(headings(container, 'h3')).not.toContain('リンク元のサイト');
    expect(h2[0]).toBe('到達のお知らせ');

    expect(text).toContain(
      'この記事は、読まれた回数を数え始めた日（2025 年 10 月 8 日）より前に公開されました。',
    );
    expect(text).toContain(
      'この期間に 150 回読まれました。2025 年 10 月 8 日からの合計は 900 回です。',
    );
    expect(text).not.toContain('公開からの合計は');
    expect(text).not.toContain('—（伏せ値）');
    expect(text).not.toContain('まだ比較できません');
    expect(text).not.toContain('公開から 30 日たつと出ます');
    expect(text).toContain('公開日 2025 年 6 月 1 日');
    expect(text).not.toContain('日目）');
  });

  it('到達は「1 年たっても読まれています」を先頭に、「数え始めてから」の文言で出す', () => {
    const data: ArticleDetailData = {
      ...detail(101),
      milestones: [{ milestone: 500, reachedOn: '2026-03-02' }],
    };
    const text = textOf(sectionOf(show(data), 's03-milestone'));
    const evergreen = text.indexOf('1 年たっても読まれています');
    const reached = text.indexOf('数え始めてから 500 回読まれました（2026 年 3 月 2 日）');
    expect(evergreen).toBeGreaterThanOrEqual(0);
    expect(reached).toBeGreaterThan(evergreen);
  });

  it('到達がないときは「数え始めてから 500 回読まれると…」', () => {
    const data: ArticleDetailData = { ...detail(101), milestones: [], isEvergreen365: false };
    const text = textOf(sectionOf(show(data), 's03-milestone'));
    expect(text).toContain('数え始めてから 500 回読まれると、最初のお知らせが出ます');
  });
});

describe('S-03 記事詳細: 日ごとの読まれた回数', () => {
  it('選んだ期間が記事の公開より前なら、その旨を書く', async () => {
    const container = show(detail(104));
    const select = container.querySelector('select');
    if (select === null) throw new Error('月の選択がありません');
    fireEvent.change(select, { target: { value: 'm2026-10' } });
    await waitFor(() => {
      expect(textOf(sectionOf(container, 's03-daily'))).toContain(
        'この期間は、記事を公開する前です。',
      );
    });
    expect(sectionOf(container, 's03-daily').querySelector('svg')).toBeNull();
  });

  it('直近 90 日は週ごとを既定にし、日ごとに切り替えられる', async () => {
    const base = detail(102);
    const last28 = base.period.last28;
    const breakdown28 = base.breakdown.last28;
    if (last28 === undefined || breakdown28 === undefined) throw new Error('値がありません');
    const last90: Period = {
      id: 'last90',
      kind: 'window',
      start: '2026-08-06',
      end: '2026-11-03',
      isConfirmed: false,
      label: '直近 90 日',
      prevId: null,
      yoyId: null,
    };
    const data: ArticleDetailData = {
      ...base,
      periods: [...base.periods, last90],
      period: { ...base.period, last90: last28 },
      breakdown: { ...base.breakdown, last90: breakdown28 },
    };
    const container = show(data);
    expect(container.querySelector('[aria-label="グラフのまとめ方"]')).toBeNull();

    fireEvent.click(button(container, '直近 90 日'));
    await waitFor(() => {
      expect(container.querySelector('[aria-label="グラフのまとめ方"]')).not.toBeNull();
    });
    const daily = sectionOf(container, 's03-daily');
    expect(button(container, '週ごと').getAttribute('aria-pressed')).toBe('true');
    expect(textOf(daily.querySelector('[data-part="fixed-row"]'))).toContain('〜');

    fireEvent.click(button(container, '日ごと'));
    expect(button(container, '日ごと').getAttribute('aria-pressed')).toBe('true');
    expect(textOf(daily.querySelector('[data-part="fixed-row"]'))).not.toContain('〜');
  });
});

describe('S-03 記事詳細: リンクと安全', () => {
  it('著者の slug は href にだけ使い、文字として出さない', () => {
    const container = show(detail(102));
    expect(textOf(container)).not.toContain(SATO);
    expect(textOf(container.querySelector(`a[href="/authors/${SATO}"]`))).toBe('さとう はなこ');

    cleanup();
    expect(textOf(show(detail(104)))).not.toContain(TANAKA);
  });

  it('著者ページのない著者は、名前をリンクにしない', () => {
    const base = detail(102);
    const container = show({ ...base, post: { ...base.post, authorSlug: null } });
    expect(container.querySelector('a[href^="/authors/"]')).toBeNull();
    expect(textOf(container)).toContain('さとう はなこ');
  });

  it('外部リンクは https://takatsu-connect.com/ 配下だけ', () => {
    const container = show(detail(102));
    const hrefs = all(container, 'a').map((node) => node.getAttribute('href') ?? '');
    const outside = hrefs.filter(
      (href) => !href.startsWith('/') && !href.startsWith('https://takatsu-connect.com/'),
    );
    expect(outside).toEqual([]);
    expect(hrefs).toContain('https://takatsu-connect.com/archives/102/');
    // リンク元のドメインは文字だけで、リンクにしない。
    expect(container.querySelector('a[href*="google.com"]')).toBeNull();
  });

  it('記事の URL が高津コネクトの外なら、リンクにしない', () => {
    const base = detail(102);
    const container = show({ ...base, post: { ...base.post, url: 'https://example.com/x' } });
    expect(container.querySelector('a[target="_blank"]')).toBeNull();
    expect(textOf(container)).toContain('記事 102');
  });

  it.each([101, 102, 103, 104])('記事 %i: style 属性がなく、使わない語が本文にない', (postId) => {
    const data = detail(postId);
    expect(renderToStaticMarkup(<ArticleDetailScreen data={data} />)).not.toContain('style=');
    const text = textOf(show(data));
    for (const word of FORBIDDEN_WORDS) {
      expect(text).not.toContain(word);
    }
    expect(text).not.toMatch(/出ません/);
  });
});
