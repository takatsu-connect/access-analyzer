/**
 * S-05 著者ページ（05 §6.2、FR-31〜FR-34、NFR-35、NFR-36、NFR-98）。
 *
 * 誰でも見られるページなので、出してはいけないもの（ほかの著者との比較、連番、slug、
 * 二人称、著者の本数の分布との比較、読まれていた時間）が出ていないことを、節ごとに確かめる。
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';

import { buildAuthorPage } from '@/data/pages';
import type { AuthorPageData, Band } from '@/lib/page-data';
import { AuthorScreen } from '@/screens/s05/AuthorScreen';

import { BUILT_AT, makeCache, SATO, TANAKA } from '../../data/fixture';

const SATO_NAME = 'さとう はなこ';
const TANAKA_NAME = 'たなか たろう';
const SUMMARY_H2 = 'この期間のまとめ';
const REFERRER_H2 = '読者はどこから来たか';
const POSTS_CAPTION = `${SATO_NAME}さんの記事の一覧`;
const DOT_POSITIONS = ['12.5%', '50%', '87.5%'];

/** 05 §2.1 の使わない語と、使わない文末。 */
const UNUSED_WORDS = [
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
  '出ません',
];

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

function pageData(slug: string): AuthorPageData {
  const data = buildAuthorPage(makeCache(), slug, BUILT_AT);
  if (data === null) throw new Error('フィクスチャに著者がいません。');
  return data;
}

/** URL のクエリを決めてから描く。パスには slug を入れない。 */
function show(data: AuthorPageData, search = ''): HTMLElement {
  window.history.replaceState(null, '', `/authors/page${search}`);
  return render(<AuthorScreen data={data} />).container;
}

function sectionOf(h2: string): HTMLElement {
  const section = screen.getByRole('heading', { level: 2, name: h2 }).closest('section');
  if (section === null) throw new Error(`節「${h2}」がありません。`);
  return section;
}

/** 表の行の、記事のタイトル（上から）。 */
function titlesOf(table: HTMLElement): (string | null)[] {
  return [...table.querySelectorAll('tbody th[scope="row"] a[href^="/articles/"]')].map(
    (link) => link.textContent,
  );
}

/** さとうさんに、直近 28 日の流入元（伏せ値なし）を足す。 */
function withVisibleBreakdown(data: AuthorPageData): AuthorPageData {
  data.breakdown.last28 = {
    channel: { search: 60, social: 30, direct: 10, referral: 0, other: 0 },
    sns: { instagram: 20, facebook: 5, x: 5, line: 0, other: 0 },
  };
  return data;
}

describe('S-05 見出しと全体', () => {
  test('h1 は表示名で書き、「高津コネクトの紹介ページ」の外部リンクを添える', () => {
    show(pageData(SATO));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      `${SATO_NAME}さんの記事は、この期間どう読まれた？`,
    );
    const link = screen.getByRole('link', { name: /^高津コネクトの紹介ページ/ });
    expect(link.getAttribute('aria-label')).toBe(
      `高津コネクトの紹介ページ（${SATO_NAME}さんの高津コネクトのページを新しいタブで開きます）`,
    );
    expect(link.getAttribute('href')).toBe(`https://takatsu-connect.com/author/${SATO}/`);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.textContent).toContain('↗');
  });

  test.each([
    [SATO, ''],
    [SATO, '?p=last7'],
    [TANAKA, ''],
    [TANAKA, '?p=last7&sort=pv30'],
  ])('本文に slug、二人称、使わない語が現れない（%s %s）', (slug, search) => {
    const container = show(withVisibleBreakdown(pageData(slug)), search);
    const text = container.textContent;
    expect(text).not.toContain(SATO);
    expect(text).not.toContain(TANAKA);
    for (const word of UNUSED_WORDS) {
      expect(text).not.toContain(word);
    }
    // 著者の本数の分布との比較（「1 人あたり ◯本が真ん中です」）を出さない。
    expect(text).not.toContain('1 人あたり');
    expect(text).not.toContain('真ん中です');
    // ほかの著者の名前も数値も出さない。
    expect(text).not.toContain(slug === SATO ? TANAKA_NAME : SATO_NAME);
  });

  test('連番（順位の数字）をどの表にも付けない', () => {
    const container = show(withVisibleBreakdown(pageData(SATO)));
    const rows = [...container.querySelectorAll('tbody tr')];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const first = row.firstElementChild;
      // 行の先頭は、名前（記事のタイトル、区分、カテゴリ）か「詳しく」。数字だけのセルではない。
      expect(first?.textContent).not.toMatch(/^\s*\d+\s*$/);
    }
    expect(container.textContent).not.toMatch(/\d\s*位/);
    expect(container.querySelector('ol')).toBeNull();
  });

  test('style 属性を出さない', () => {
    const container = show(withVisibleBreakdown(pageData(SATO)));
    expect(container.querySelectorAll('*').length).toBeGreaterThan(0);
    expect(container.querySelector('[style]')).toBeNull();
    cleanup();
    expect(show(pageData(TANAKA), '?p=last7&sort=pv7').querySelector('[style]')).toBeNull();
  });

  test('期間を選ぶと、まとめが切り替わり、URL に書き戻す', () => {
    show(pageData(SATO));
    expect(sectionOf(SUMMARY_H2).textContent).toContain('この期間に公開した記事は 1 本です。');
    fireEvent.click(screen.getByRole('button', { name: '直近 7 日' }));
    expect(window.location.search).toBe('?p=last7');
    expect(sectionOf(SUMMARY_H2).textContent).toContain(
      'どれも、この期間より前に公開した記事です。',
    );
  });

  test('期間のデータがないときは、まとめを出さずに「まだありません」と書く', () => {
    show(pageData(SATO), '?p=m2026-10');
    const text = sectionOf(SUMMARY_H2).textContent;
    expect(text).toContain('この期間の数字はまだありません。');
    expect(text).not.toContain('公開した記事は');
    expect(text).not.toContain('くらい読まれています');
    expect(sectionOf(REFERRER_H2).textContent).toContain('この期間の数字はまだありません。');
  });
});

describe('S-05 (a) 読まれた回数の合計と、公開した本数', () => {
  // 0 本のとき、合計を出すことと (c) の行は tests/screens/s05/review.test.tsx（助言 B-3）。

  test('前の期間との比較は差だけで、% を出さない（分母が 20 以上でも）', () => {
    const data = pageData(TANAKA);
    data.period.prev28 = { postCount: 1, pageviews: 300, longPostCount: 1, longPageviews: 150 };
    show(data);
    const text = sectionOf(SUMMARY_H2).textContent;
    expect(text).toContain(
      `${TANAKA_NAME}さんの記事は、この期間に合計 362 回読まれました（前の 28 日と比べて +62）。この期間に公開した記事は 2 本です（前の 28 日は 1 本）。`,
    );
    // (c) も差だけ。
    expect(text).toContain('そのうち、公開から 3 か月以上たった 1 本の記事が 200 回読まれました。');
    expect(text).toContain('+50');
    expect(text).not.toContain('%');
  });

  test('前の期間の数字がなければ、比較を付けない', () => {
    show(pageData(TANAKA));
    const text = sectionOf(SUMMARY_H2).textContent;
    expect(text).toContain(
      `${TANAKA_NAME}さんの記事は、この期間に合計 362 回読まれました。この期間に公開した記事は 2 本です。`,
    );
    expect(text).not.toContain('と比べて');
  });

  test('月を選んだときは「前の月と比べて」「前の月は」と書く', () => {
    // 終わった月（2026 年 10 月）。前の月の値を足す。月の途中の月は比較を止める（usePeriod）。
    const data = pageData(TANAKA);
    data.period['m2026-10'] = {
      postCount: 1,
      pageviews: 328,
      longPostCount: 1,
      longPageviews: 190,
    };
    data.period['m2026-09'] = {
      postCount: 2,
      pageviews: 300,
      longPostCount: 1,
      longPageviews: 150,
    };
    // フィクスチャには 2026 年 9 月の期間がないので、10 月の比較の相手を 9 月にする。
    data.periods = data.periods.map((item) =>
      item.id === 'm2026-10' ? { ...item, prevId: 'm2026-09' } : item,
    );
    show(data, '?p=m2026-10');
    const text = sectionOf(SUMMARY_H2).textContent;
    expect(text).toContain(
      '（前の月と比べて +28）。この期間に公開した記事は 1 本です（前の月は 2 本）。',
    );
    expect(text).not.toMatch(/前の\s*\d+\s*日/);
    expect(text).not.toContain('%');
  });
});

describe('S-05 (b) これまでの記事と、多くの記事の範囲', () => {
  test('文は「◯◯さんの記事は、公開から 30 日で」で始まり、注記を添える', () => {
    show(pageData(SATO));
    const section = sectionOf(SUMMARY_H2);
    const sentences = [...section.querySelectorAll('p')].filter((paragraph) =>
      paragraph.textContent.startsWith(`${SATO_NAME}さんの記事は、公開から 30 日で`),
    );
    expect(sentences.length).toBe(1);
    expect(sentences[0]?.textContent).toBe(
      `${SATO_NAME}さんの記事は、公開から 30 日で 230 回くらい読まれています。多くの記事は 100〜300 回（真ん中は 200 回）です。`,
    );
    expect(section.textContent).toContain('成績ではなく、位置です。');
    expect(section.textContent).toContain(
      '直近 1 年に公開し、30 日たった記事（広告を除く）で見ています。',
    );
  });

  test('帯の点は 3 つの固定位置のどれかで、値に比例しない', () => {
    const bands: Band[] = ['lower', 'middle', 'upper'];
    const positions = bands.map((band) => {
      const data = pageData(SATO);
      data.summary.band30 = band;
      // 同じ区分なら、値が違っても同じ位置。
      data.summary.ownMedian30d = band === 'middle' ? 101 : 299;
      show(data);
      const dots = sectionOf(SUMMARY_H2).querySelectorAll('circle[data-part="dot"]');
      expect(dots.length).toBe(1);
      const position = dots[0]?.getAttribute('cx') ?? '';
      cleanup();
      return position;
    });
    for (const position of positions) {
      expect(DOT_POSITIONS).toContain(position);
    }
    expect(new Set(positions).size).toBe(3);
  });

  test('当てはまる記事が 5 本未満なら、不在の文を出し、帯を描かない', () => {
    show(pageData(TANAKA));
    const section = sectionOf(SUMMARY_H2);
    expect(section.textContent).toContain(
      '直近 1 年に公開して 30 日たった記事が 5 本以上になると出ます',
    );
    expect(section.textContent).not.toContain('くらい読まれています');
    expect(section.querySelector('circle[data-part="dot"]')).toBeNull();
  });

  test('多くの記事の範囲がまだないときは、後半を出さず「まだ比較できません」', () => {
    const data = pageData(SATO);
    data.benchmark = null;
    data.summary.band30 = null;
    show(data);
    const section = sectionOf(SUMMARY_H2);
    expect(section.textContent).toContain(
      `${SATO_NAME}さんの記事は、公開から 30 日で 230 回くらい読まれています。`,
    );
    expect(section.textContent).not.toContain('多くの記事は');
    expect(section.textContent).toContain('まだ比較できません');
    expect(section.querySelector('circle[data-part="dot"]')).toBeNull();
  });

  test('どの記事も数え始める前の公開なら、書くことを求める文にしない', () => {
    const data = pageData(SATO);
    data.posts = data.posts.filter((post) => post.isPreMeasure);
    data.summary = { ownMedian30d: null, eligibleCount: 0, band30: null };
    show(data);
    const text = sectionOf(SUMMARY_H2).textContent;
    expect(text).toContain(
      `${SATO_NAME}さんの記事は、どれも2025 年 10 月 8 日より前に公開されたので、最初の 1 か月の数字は残っていません。`,
    );
    expect(text).not.toContain('5 本以上');
  });
});

describe('S-05 (d) 到達のお知らせ', () => {
  test('期間内の到達がなければ、見出しごと出さない', () => {
    // フィクスチャの到達は 2026 年 2〜3 月で、直近 28 日の外。
    show(pageData(SATO));
    expect(screen.queryByRole('heading', { name: '到達のお知らせ' })).toBeNull();
  });

  test('期間内の到達があれば、記事のタイトル、節目、日付を出す', () => {
    const data = pageData(SATO);
    data.milestones.push({ postId: 102, milestone: 5000, reachedOn: '2026-10-30' });
    data.milestones.push({ postId: 101, milestone: 1000, reachedOn: '2026-11-03' });
    show(data);
    const heading = screen.getByRole('heading', { level: 3, name: '到達のお知らせ' });
    const items = within(heading.parentElement ?? heading).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      '記事 1025,000 回読まれました（10 月 30 日）',
      // 数え始める前に公開した記事は「数え始めてから」。
      '記事 101数え始めてから 1,000 回読まれました（11 月 3 日）',
    ]);
  });

  test('期間の外の到達は、その期間では出さない', () => {
    const data = pageData(SATO);
    data.milestones.push({ postId: 102, milestone: 5000, reachedOn: '2026-10-06' });
    show(data);
    expect(screen.queryByRole('heading', { name: '到達のお知らせ' })).toBeNull();
  });
});

describe('S-05 読者はどこから来たか', () => {
  test('この著者の棒に、サイト全体の構成比の輪郭と凡例を重ねる', () => {
    show(withVisibleBreakdown(pageData(SATO)));
    const section = sectionOf(REFERRER_H2);
    expect(section.textContent).toContain('訪問 100 回のうち');
    // 流入チャネルの 5 区分に、輪郭が 1 つずつ。
    expect(section.querySelectorAll('[data-part="compare"]').length).toBe(5);
    expect(section.querySelectorAll('[data-part="bar"]').length).toBe(10);
    expect(within(section).getByText('細い枠: サイト全体')).toBeTruthy();
    expect(section.textContent).toContain('60（60%）');
    expect(section.textContent).toContain('サイト全体: 70%');
    expect(section.textContent).toContain('傾向として見るためのもので、良し悪しではありません。');
    // SNS の種類（h3）。サイト全体の値が 20 未満なので、輪郭は付かない。
    expect(within(section).getByRole('heading', { level: 3, name: 'SNS の種類' })).toBeTruthy();
    expect(section.textContent).toContain('訪問 30 回のうち');
  });

  test('図と同じ値の表を併記する', () => {
    show(withVisibleBreakdown(pageData(SATO)));
    const table = screen.getByRole('table', {
      name: `${SATO_NAME}さんの記事への訪問回数（どこから来たか）`,
    });
    const headers = [...table.querySelectorAll('thead th')].map((cell) => cell.textContent);
    expect(headers).toEqual(['読者はどこから来たか', '訪問回数', '割合', 'サイト全体の割合']);
    const first = [...(table.querySelector('tbody tr')?.children ?? [])].map(
      (cell) => cell.textContent,
    );
    expect(first).toEqual(['検索', '60', '60%', '70%']);
  });

  test('全区分が 0 のときは、0 を 0 として出し、前置きと % を出さない', () => {
    const data = withVisibleBreakdown(pageData(SATO));
    if (data.breakdown.last28 !== undefined) {
      data.breakdown.last28.sns = { instagram: 0, facebook: 0, x: 0, line: 0, other: 0 };
    }
    show(data);
    const block = within(sectionOf(REFERRER_H2)).getByRole('heading', {
      level: 3,
      name: 'SNS の種類',
    }).parentElement;
    expect(block?.querySelector('g[data-key="instagram"] [data-part="value"]')?.textContent).toBe(
      '0',
    );
    expect(block?.textContent).not.toContain('回のうち');
    expect(block?.textContent).not.toContain('%');
    expect(block?.textContent).not.toContain('伏せ値');
  });

  test('伏せ値があるときは前置きも % も出さず、表の伏せ値は「— 伏せ値」', () => {
    // 直近 7 日のさとうさん: 流入チャネルの SNS と、SNS の種類の Instagram が伏せ値。
    // 文にする形（助言 B-4）は tests/screens/s05/review.test.tsx。
    show(pageData(SATO), '?p=last7');
    const section = sectionOf(REFERRER_H2);
    const table = within(section).getByRole('table', {
      name: `${SATO_NAME}さんの記事への訪問回数（どこから来たか）`,
    });
    const social = [...table.querySelectorAll('tbody tr')].find((row) =>
      row.textContent.startsWith('SNS'),
    );
    expect(social?.textContent).toContain('伏せ値');
    expect(section.textContent).not.toContain('回のうち');
    expect(section.textContent).not.toContain('%');
    // 棒も、サイト全体の輪郭も凡例も出さない。
    expect(section.querySelector('[data-part="bar"]')).toBeNull();
    expect(section.querySelector('[data-part="compare"]')).toBeNull();
    expect(section.textContent).not.toContain('サイト全体');
  });
});

describe('S-05 どのカテゴリの記事を書いたか', () => {
  test('カテゴリのパス、これまでの記事数、この期間の読まれた回数を、読まれた回数の多い順に出す', () => {
    show(pageData(SATO), '?p=last7');
    const table = screen.getByRole('table', {
      name: `${SATO_NAME}さんの記事の、カテゴリごとの記事数と読まれた回数`,
    });
    const headers = [...table.querySelectorAll('thead th')].map((cell) => cell.textContent);
    expect(headers).toEqual(['カテゴリ', 'これまでの記事数', '読まれた回数（この期間）']);
    const rows = [...table.querySelectorAll('tbody tr')].map((row) =>
      [...row.children].map((cell) => cell.textContent),
    );
    expect(rows).toEqual([
      ['記事 > グルメ', '2', '45'],
      ['広告 > PR', '1', '20'],
    ]);
  });
});

describe('S-05 最近よく読まれている記事 / 久しぶりに読まれた記事', () => {
  test('それぞれ、タイトル、公開日、直近 7 日の読まれた回数を出す', () => {
    show(pageData(TANAKA));
    const hot = screen.getByRole('table', {
      name: `${TANAKA_NAME}さんの、最近よく読まれている記事`,
    });
    // 直近 7 日の読まれた回数の多い順（記事 103 = 60、記事 104 = 12）。
    expect(titlesOf(hot)).toEqual(['記事 103', '記事 104']);
    const revival = screen.getByRole('table', {
      name: `${TANAKA_NAME}さんの、久しぶりに読まれた記事`,
    });
    expect(titlesOf(revival)).toEqual(['記事 106']);
    const headers = [...revival.querySelectorAll('thead th')].map((cell) => cell.textContent);
    expect(headers).toEqual(['記事', '公開日', '直近 7 日の読まれた回数']);
    expect(revival.querySelector('tbody tr')?.textContent).toContain('90');
    expect(screen.getByText('目安です。公開直後の記事は対象外です。')).toBeTruthy();
  });

  test('どちらの記事もなければ、h3 と表を出さず、1 文だけ出す', () => {
    const data = pageData(SATO);
    data.posts = data.posts.map((post) => ({ ...post, isRecentHot: false, isRevival: false }));
    show(data);
    const section = sectionOf('いま読まれている記事');
    expect(section.textContent).toBe(
      'いま読まれている記事ふだんよりはっきり多く読まれた記事があると、ここに出ます（直近 7 日で見ています）。',
    );
    expect(section.querySelector('h3')).toBeNull();
    expect(section.querySelector('table')).toBeNull();
    expect(section.textContent).not.toContain('今週は該当する記事がありません');
  });

  test('広告の記事は、印が付いていても選ばない（S-02d と同じ選び方）。記事の一覧には「広告」の印で出す', () => {
    const data = pageData(SATO);
    // 記事 105 は広告。最近よく読まれている印と久しぶりの印を付けても、ここには出さない。
    data.posts = data.posts.map((post) =>
      post.id === 105 ? { ...post, isRecentHot: true, isRevival: true } : post,
    );
    expect(data.posts.find((post) => post.id === 105)?.isAd).toBe(true);
    show(data);
    const section = sectionOf('いま読まれている記事');
    expect(within(section).queryByRole('link', { name: '記事 105' })).toBeNull();

    const list = screen.getByRole('table', { name: POSTS_CAPTION });
    const row = within(list).getByRole('link', { name: '記事 105' }).closest('tr');
    expect(row?.querySelector('th')?.textContent).toContain('広告');
    const other = within(list).getByRole('link', { name: '記事 101' }).closest('tr');
    expect(other?.querySelector('th')?.textContent).not.toContain('広告');
  });

  test('5 件までにする', () => {
    const data = pageData(TANAKA);
    const base = data.posts[0];
    if (base === undefined) throw new Error('フィクスチャに記事がありません。');
    data.posts = [0, 1, 2, 3, 4, 5, 6].map((index) => ({
      ...base,
      id: 900 + index,
      title: `記事 ${900 + index}`,
      isRecentHot: true,
      isRevival: false,
    }));
    data.pvByPeriod = { last7: [10, 20, 30, 40, 50, 60, 70] };
    data.topChannelByPeriod = {};
    show(data);
    const hot = screen.getByRole('table', {
      name: `${TANAKA_NAME}さんの、最近よく読まれている記事`,
    });
    expect(titlesOf(hot)).toEqual(['記事 906', '記事 905', '記事 904', '記事 903', '記事 902']);
  });
});

describe('S-05 記事の一覧', () => {
  test('列に、著者、読まれていた時間がない', () => {
    const container = show(pageData(SATO));
    const table = screen.getByRole('table', { name: POSTS_CAPTION });
    const headers = [...table.querySelectorAll('thead th')].map((cell) => cell.textContent);
    expect(headers).toEqual([
      '記事',
      '公開日',
      'カテゴリ',
      '読まれた回数（この期間）',
      '最初の 1 週間',
      '最初の 1 か月',
      '多くの記事と比べて',
      'どこから来たか',
    ]);
    const allHeaders = [...container.querySelectorAll('thead th')].map((cell) => cell.textContent);
    expect(allHeaders).not.toContain('ライター');
    expect(container.textContent).not.toContain('読まれていた時間');
  });

  test('並べ替えの UI があり、公開日の新しい順と、多い順だけ', () => {
    show(pageData(SATO));
    const groups = screen.getAllByRole('group', { name: '並び' });
    expect(groups.length).toBe(1);
    const labels = within(groups[0] ?? document.body)
      .getAllByRole('button')
      .map((button) => button.textContent);
    expect(labels).toEqual([
      '公開日の新しい順',
      '読まれた回数の多い順',
      '最初の 1 週間の多い順',
      '最初の 1 か月の多い順',
    ]);
  });

  test('既定は公開日の新しい順で、並べ替えると行の順が変わる', () => {
    show(pageData(SATO));
    expect(titlesOf(screen.getByRole('table', { name: POSTS_CAPTION }))).toEqual([
      '記事 105',
      '記事 102',
      '記事 101',
    ]);
    const button = screen.getByRole('button', { name: '読まれた回数の多い順' });
    fireEvent.click(button);
    // 直近 28 日: 記事 101 = 150、記事 105 = 55、記事 102 = 30。
    expect(titlesOf(screen.getByRole('table', { name: POSTS_CAPTION }))).toEqual([
      '記事 101',
      '記事 105',
      '記事 102',
    ]);
    expect(window.location.search).toBe('?sort=pv');
    expect(
      screen.getByRole('button', { name: '読まれた回数の多い順' }).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  test('URL の sort を、絞り込みなしで受け付ける', () => {
    show(pageData(SATO), '?sort=pv');
    expect(titlesOf(screen.getByRole('table', { name: POSTS_CAPTION }))).toEqual([
      '記事 101',
      '記事 105',
      '記事 102',
    ]);
  });

  test('数え始める前の記事のセルは「—」でなく「数え始める前」', () => {
    show(pageData(SATO));
    const table = screen.getByRole('table', { name: POSTS_CAPTION });
    const row = within(table).getByRole('link', { name: '記事 101' }).closest('tr');
    // 広い画面の中身（狭い画面用の名前つきの中身は別に描く）。
    const cells = [...(row?.querySelectorAll('td') ?? [])].map(
      (cell) => (cell.querySelector('[data-part="wide-cell"]') ?? cell).textContent,
    );
    // 公開日、カテゴリ、読まれた回数（この期間）、最初の 1 週間、最初の 1 か月、多くの記事と比べて、どこから来たか。
    expect(cells.slice(0, 6)).toEqual([
      '2025/06/01',
      '記事 > グルメ',
      '150',
      '数え始める前',
      '数え始める前',
      '数え始める前',
    ]);
    // 表の上に、日付つきの注記を 1 行。
    expect(
      screen.getByText(/「数え始める前」: 2025 年 10 月 8 日より前に公開された記事です。/),
    ).toBeTruthy();
  });

  test('最初の 1 か月で並べるときは、数え始める前の記事を区切りの下にまとめる', () => {
    show(pageData(SATO));
    fireEvent.click(screen.getByRole('button', { name: '最初の 1 か月の多い順' }));
    // 記事 102 = 400、記事 105 = 60。
    expect(titlesOf(screen.getByRole('table', { name: POSTS_CAPTION }))).toEqual([
      '記事 102',
      '記事 105',
    ]);
    expect(
      screen.getByText(
        'ここから下は、2025 年 10 月 8 日より前に公開された記事です（公開日の新しい順）。',
      ),
    ).toBeTruthy();
    const older = screen.getByRole('table', {
      name: `${SATO_NAME}さんの記事のうち、数え始める前に公開した記事の一覧`,
    });
    expect(titlesOf(older)).toEqual(['記事 101']);
    // 並べ替えの UI は 1 つだけ。
    expect(screen.getAllByRole('group', { name: '並び' }).length).toBe(1);
  });
});
