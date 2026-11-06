/**
 * S-05 構築 3 のレビューと助言（advice/2026-11-05-build3-screens-text.md A-1、A-2、B-3、B-4）の反映を固定する。
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';

import { buildAuthorPage } from '@/data/pages';
import type { AuthorPageData } from '@/lib/page-data';
import { AuthorScreen } from '@/screens/s05/AuthorScreen';

import { BUILT_AT, makeCache, SATO, TANAKA } from '../../data/fixture';

const SATO_NAME = 'さとう はなこ';
const TANAKA_NAME = 'たなか たろう';
const SUMMARY_H2 = 'この期間のまとめ';
const REFERRER_H2 = '読者はどこから来たか';
const RECENT_H2 = 'いま読まれている記事';

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

function pageData(slug: string): AuthorPageData {
  const data = buildAuthorPage(makeCache(), slug, BUILT_AT);
  if (data === null) throw new Error('フィクスチャに著者がいません。');
  return data;
}

function show(data: AuthorPageData, search = ''): HTMLElement {
  window.history.replaceState(null, '', `/authors/page${search}`);
  return render(<AuthorScreen data={data} />).container;
}

function sectionOf(h2: string): HTMLElement {
  const section = screen.getByRole('heading', { level: 2, name: h2 }).closest('section');
  if (section === null) throw new Error(`節「${h2}」がありません。`);
  return section;
}

/** まとめの、文の段落（p）の文字。 */
function paragraphsOf(section: HTMLElement): string[] {
  return [...section.querySelectorAll('p')].map((node) => node.textContent);
}

describe('S-05 まとめ (a)(c)（B-3）', () => {
  test('さとう × last7: 合計 65 回が先に出て、「以前に書いた」がない', () => {
    show(pageData(SATO), '?p=last7');
    const text = sectionOf(SUMMARY_H2).textContent;
    // 公開から 3 か月未満の記事 105 の 20 回も、合計に入っている（65 = 45 + 20）。
    expect(text).toContain(`${SATO_NAME}さんの記事は、この期間に合計 65 回読まれました。`);
    expect(text).not.toContain('以前に書いた');
    expect(text).not.toContain('公開した記事はありません');
  });

  test('0 本のときは「どれも、この期間より前に公開した記事です。」と (c) の行', () => {
    const paragraphs = paragraphsOf((show(pageData(SATO), '?p=last7'), sectionOf(SUMMARY_H2)));
    expect(paragraphs[0]).toBe(
      `${SATO_NAME}さんの記事は、この期間に合計 65 回読まれました。どれも、この期間より前に公開した記事です。`,
    );
    // 合計の比較は差だけ（65 − 40 = +25）。
    expect(paragraphs[1]).toContain('前の 7 日と比べて');
    expect(paragraphs[1]).toContain('+25');
    // (c) は別の行。
    expect(paragraphs).toContain(
      'そのうち、公開から 3 か月以上たった 2 本の記事が 45 回読まれました。',
    );
    expect(sectionOf(SUMMARY_H2).textContent).not.toContain('%');
  });

  test('ふだんの文は合計が先で、本数に ▲▼ を付けず前の期間の本数を並べる', () => {
    const data = pageData(TANAKA);
    data.period.prev28 = { postCount: 3, pageviews: 300, longPostCount: 1, longPageviews: 150 };
    show(data);
    const [first] = paragraphsOf(sectionOf(SUMMARY_H2));
    expect(first).toBe(
      `${TANAKA_NAME}さんの記事は、この期間に合計 362 回読まれました（前の 28 日と比べて +62）。この期間に公開した記事は 2 本です（前の 28 日は 3 本）。`,
    );
    // 本数の差（−1）は出さない。
    expect(first).not.toContain('−1');
    expect(first).not.toContain('▼');
  });

  test('前の期間がないときは括弧なし', () => {
    show(pageData(TANAKA));
    const [first] = paragraphsOf(sectionOf(SUMMARY_H2));
    expect(first).toBe(
      `${TANAKA_NAME}さんの記事は、この期間に合計 362 回読まれました。この期間に公開した記事は 2 本です。`,
    );
  });

  test('3 か月以上の記事がないときは (c) の行を出さない', () => {
    const data = pageData(SATO);
    data.period.last7 = { postCount: 0, pageviews: 65, longPostCount: 0, longPageviews: 0 };
    show(data, '?p=last7');
    const text = sectionOf(SUMMARY_H2).textContent;
    expect(text).toContain(`${SATO_NAME}さんの記事は、この期間に合計 65 回読まれました。`);
    expect(text).not.toContain('そのうち');
    expect(text).not.toContain('3 か月以上たった記事ができると');
    expect(text).not.toContain('0 本');
  });
});

describe('S-05 最近 / 久しぶり（A-1）', () => {
  test('両方ないときは h3 と表を出さず、1 文だけ', () => {
    const data = pageData(SATO);
    data.posts = data.posts.map((post) => ({ ...post, isRecentHot: false, isRevival: false }));
    show(data);
    const section = sectionOf(RECENT_H2);
    expect(within(section).queryAllByRole('heading', { level: 3 })).toEqual([]);
    expect(section.querySelector('table')).toBeNull();
    expect(section.textContent).toContain(
      'ふだんよりはっきり多く読まれた記事があると、ここに出ます（直近 7 日で見ています）。',
    );
    expect(section.textContent).not.toContain('該当する');
  });

  test('片方だけあるときは、ある方の h3 だけ', () => {
    // さとうさんは、久しぶりに読まれた記事（101）だけ。最近よく読まれている記事（105）は広告なので出ない。
    const data = pageData(SATO);
    data.posts = data.posts.map((post) => ({ ...post, isRecentHot: false }));
    show(data);
    const section = sectionOf(RECENT_H2);
    const h3 = within(section)
      .getAllByRole('heading', { level: 3 })
      .map((node) => node.textContent);
    expect(h3).toEqual(['久しぶりに読まれた記事']);
    expect(section.querySelectorAll('table').length).toBe(1);
    expect(section.textContent).not.toContain('ふだんよりはっきり');
  });
});

describe('S-05 流入元に伏せ値があるとき（B-4）', () => {
  test('伏せ値が 1 つある著者は棒がなく、見える数の文と伏せ値の文が出る', () => {
    // さとう × last7: 検索 30、SNS は伏せ値、ほかは 0。
    show(pageData(SATO), '?p=last7');
    const section = sectionOf(REFERRER_H2);
    expect(section.querySelector('[data-part="bar"]')).toBeNull();
    expect(section.querySelector('svg')).toBeNull();
    expect(section.textContent).toContain('検索から 30 回の訪問がありました。');
    expect(section.textContent).toContain(
      'SNSは伏せ値です（小さな数は表示していません）。期間を「直近 90 日」にすると、数字が出やすくなります。',
    );
    expect(section.textContent).not.toContain('いちばん多い');
    // 表は残す（同じ数字を表で見る）。
    expect(within(section).getByText('同じ数字を表で見る')).toBeTruthy();
  });

  test('0 の区分は文に入れない。見える数がなければ text の文を出さない', () => {
    const data = pageData(SATO);
    data.breakdown.last7 = {
      channel: { search: 162, social: 40, direct: null, referral: 0, other: null },
      sns: { instagram: 30, facebook: 10, x: 0, line: 0, other: 0 },
    };
    show(data, '?p=last7');
    let text = sectionOf(REFERRER_H2).textContent;
    expect(text).toContain('検索から 162 回、SNS から 40 回の訪問がありました。');
    expect(text).toContain('直接とその他は伏せ値です');
    expect(text).not.toContain('他のサイトから 0');
    cleanup();

    data.breakdown.last7 = {
      channel: { search: null, social: null, direct: 0, referral: 0, other: 0 },
      sns: { instagram: null, facebook: 0, x: 0, line: 0, other: 0 },
    };
    show(data, '?p=last7');
    text = sectionOf(REFERRER_H2).textContent;
    expect(text).not.toContain('の訪問がありました。');
    expect(text).toContain('検索とSNSは伏せ値です');
  });

  test('SNS が伏せ値なら「SNS の種類」を h3 ごと出さない', () => {
    show(pageData(SATO), '?p=last7');
    const section = sectionOf(REFERRER_H2);
    expect(within(section).queryByRole('heading', { level: 3, name: 'SNS の種類' })).toBeNull();
  });

  test('SNS の種類に見える数が 1 つもなければ h3 ごと出さない', () => {
    const data = pageData(SATO);
    data.breakdown.last7 = {
      channel: { search: 30, social: 20, direct: 0, referral: 0, other: 0 },
      sns: { instagram: null, facebook: null, x: null, line: null, other: null },
    };
    show(data, '?p=last7');
    const section = sectionOf(REFERRER_H2);
    expect(within(section).queryByRole('heading', { level: 3, name: 'SNS の種類' })).toBeNull();
  });

  test('伏せ値がないときは棒のまま', () => {
    const data = pageData(SATO);
    data.breakdown.last28 = {
      channel: { search: 60, social: 30, direct: 10, referral: 0, other: 0 },
      sns: { instagram: 20, facebook: 5, x: 5, line: 0, other: 0 },
    };
    show(data);
    const section = sectionOf(REFERRER_H2);
    expect(section.querySelectorAll('[data-part="bar"]').length).toBeGreaterThan(0);
    expect(section.textContent).not.toContain('の訪問がありました。');
    expect(section.textContent).not.toContain('伏せ値です');
    expect(within(section).getByRole('heading', { level: 3, name: 'SNS の種類' })).toBeTruthy();
  });
});

describe('S-05 文言の直し（中・低）', () => {
  test('これまでの記事の範囲は「直近 1 年に公開し、30 日たった記事」', () => {
    show(pageData(SATO));
    const text = sectionOf(SUMMARY_H2).textContent;
    expect(text).toContain('直近 1 年に公開し、30 日たった記事で見ています。');
    expect(text).not.toContain('以降に公開した記事');
  });

  test('カテゴリの表の h2 と列名', () => {
    show(pageData(SATO), '?p=last7');
    const section = sectionOf('どのカテゴリの記事を書いたか');
    const headers = [...section.querySelectorAll('thead th')].map((cell) => cell.textContent);
    expect(headers).toEqual(['カテゴリ', 'これまでの記事数', '読まれた回数（この期間）']);
  });

  test('「同じ数字を表で見る」', () => {
    const data = pageData(SATO);
    data.breakdown.last28 = {
      channel: { search: 60, social: 30, direct: 10, referral: 0, other: 0 },
      sns: { instagram: 20, facebook: 5, x: 5, line: 0, other: 0 },
    };
    show(data);
    const section = sectionOf(REFERRER_H2);
    expect(within(section).getAllByText('同じ数字を表で見る').length).toBe(2);
    expect(within(section).queryByText('表で見る')).toBeNull();
  });
});

describe('S-05 記事の一覧', () => {
  /** 一覧の表で、記事の行の「どこから来たか」のセル。 */
  function channelCell(title: string): string {
    const table = screen.getByRole('table', { name: `${TANAKA_NAME}さんの記事の一覧` });
    const row = within(table).getByRole('link', { name: title }).closest('tr');
    const cells = [...(row?.querySelectorAll('td') ?? [])];
    return cells.at(-1)?.textContent ?? '';
  }

  test('訪問のない記事の「どこから来たか」は「該当なし」で、伏せ値と出さない', () => {
    // たなか × last7: 記事 104 は流入チャネルの行がない（訪問なし）。
    show(pageData(TANAKA), '?p=last7');
    expect(channelCell('記事 104')).toBe('該当なし');
    expect(channelCell('記事 103')).toBe('SNS');
  });

  test('全区分が伏せ値の記事だけ伏せ値', () => {
    show(pageData(TANAKA), '?p=last7');
    // 記事 106 は全区分が伏せ値。
    expect(channelCell('記事 106')).toContain('伏せ値');
    expect(channelCell('記事 104')).not.toContain('伏せ値');
  });

  test('全区分が 0 の記事も「該当なし」', () => {
    const data = pageData(TANAKA);
    data.topChannelByPeriod.last28 = ['none', 'none', 'none'];
    show(data);
    expect(channelCell('記事 103')).toBe('該当なし');
  });

  test('カテゴリの列を出す（狭い画面では「詳しく」）', () => {
    show(pageData(SATO));
    const table = screen.getByRole('table', { name: `${SATO_NAME}さんの記事の一覧` });
    const headers = [...table.querySelectorAll('thead th')].map((cell) => cell.textContent);
    expect(headers).toContain('カテゴリ');
    const row = within(table).getByRole('link', { name: '記事 105' }).closest('tr');
    expect(row?.textContent).toContain('広告 > PR');
    // 狭い画面に残す 4 列には入れず、行の「詳しく」の中に出す。
    const more = row?.nextElementSibling;
    const terms = [...(more?.querySelectorAll('dl dt') ?? [])].map((node) => node.textContent);
    expect(terms).toContain('カテゴリ');
    expect(more?.querySelector('dl')?.textContent).toContain('広告 > PR');
  });
});
