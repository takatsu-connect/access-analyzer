import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ArticleTable, sortArticleRows } from '@/components/ArticleTable';
import type { ArticleColumnId, ArticleTableRow } from '@/components/ArticleTable';

import { makePost } from './fixtures';

/** 05 §4.2 のワイヤーの 3 行と、数え始める前の記事、著者ページのない著者の記事。 */
const ROWS: ArticleTableRow[] = [
  {
    post: makePost({ id: 201, title: '記事 A', publishedOn: '2026-10-20', ageDays: 14 }),
    pageviews: 120,
    categories: ['記事 > グルメ', '記事 > まち歩き'],
  },
  {
    post: makePost({
      id: 202,
      title: '記事 B',
      publishedOn: '2026-10-30',
      ageDays: 4,
      freshness: 'new',
      pv7: null,
      pv30: null,
      band30: 'upper',
      pvTotal: 41,
    }),
    pageviews: 41,
    categories: ['イベント'],
  },
  {
    post: makePost({
      id: 203,
      title: '記事 C',
      publishedOn: '2025-09-01',
      ageDays: 428,
      freshness: 'long',
      isPreMeasure: true,
      pv7: null,
      pv30: null,
      band30: null,
      pvTotal: 1530,
    }),
    pageviews: null,
    categories: [],
  },
  {
    post: makePost({
      id: 204,
      title: '記事 D',
      publishedOn: '2026-08-15',
      authorSlug: null,
      authorName: '溝口 太郎',
      pv7: 30,
      pv30: 95,
    }),
    pageviews: 64,
  },
];

const ALL_COLUMNS: ArticleColumnId[] = [
  'title',
  'author',
  'publishedOn',
  'pageviews',
  'pv7',
  'pv30',
  'category',
];
const NARROW: ArticleColumnId[] = ['title', 'publishedOn', 'pageviews', 'pv30'];

/** CSS Modules のクラス名は、テストでは「_名前_ハッシュ」の形になる。名前を含むかで見る。 */
const hasClass = (element: Element, name: string): boolean =>
  (element.getAttribute('class') ?? '').includes(name);
const bodyRows = (root: HTMLElement): HTMLTableRowElement[] =>
  [...root.querySelectorAll<HTMLTableRowElement>('tbody > tr')].filter(
    (row) => row.querySelector('details') === null,
  );
const cellTexts = (row: HTMLTableRowElement): string[] =>
  [...row.cells].map((item) => item.textContent ?? '');
const titles = (root: HTMLElement): string[] =>
  bodyRows(root).map((row) => row.querySelector('th a')?.textContent ?? '');

describe('ArticleTable（U-24）', () => {
  it('連番の列がなく、行の先頭のセルが数字で始まらない', () => {
    const { container } = render(<ArticleTable caption="記事" rows={ROWS} columns={ALL_COLUMNS} />);
    const headers = [...container.querySelectorAll('thead th')].map((item) => item.textContent);
    expect(headers).toEqual([
      '記事',
      'ライター',
      '公開日',
      '読まれた回数',
      '最初の 1 週間',
      '最初の 1 か月',
      'カテゴリ',
    ]);
    bodyRows(container).forEach((row, index) => {
      const texts = cellTexts(row);
      expect(texts).toHaveLength(ALL_COLUMNS.length);
      // 先頭のセルはタイトルで、番号で始まらない。
      expect(texts[0]).not.toMatch(/^\d+\.?\s/);
      expect(texts[0]?.startsWith('記事 ')).toBe(true);
      // どのセルも、行の番号（1 始まり、0 始まり）そのものではない。
      expect(texts).not.toContain(String(index + 1));
      expect(texts).not.toContain(String(index));
    });
  });

  it('公開日は「2026/10/20」の短い形（年を省かない）で、time 要素が元の日付を持つ', () => {
    const { container } = render(<ArticleTable caption="記事" rows={ROWS} columns={ALL_COLUMNS} />);
    const times = bodyRows(container).map((row) => row.querySelector('time'));
    expect(times.map((item) => item?.textContent)).toEqual([
      '2026/10/20',
      '2026/10/30',
      '2025/09/01',
      '2026/08/15',
    ]);
    expect(times.map((item) => item?.getAttribute('datetime'))).toEqual([
      '2026-10-20',
      '2026-10-30',
      '2025-09-01',
      '2026-08-15',
    ]);
  });

  it('sortable が false のとき、並びの UI がなく、渡した順のまま描く（sort を無視する）', () => {
    const { container } = render(
      <ArticleTable caption="記事" rows={ROWS} columns={ALL_COLUMNS} sort="pv" />,
    );
    expect(screen.queryByRole('group', { name: '並び' })).toBeNull();
    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(titles(container)).toEqual(['記事 A', '記事 B', '記事 C', '記事 D']);
  });

  it('sortable のとき、並びは公開日と多い順だけ。少ない順の UI がどこにもない', () => {
    const onSortChange = vi.fn();
    const { container } = render(
      <ArticleTable
        caption="記事"
        rows={ROWS}
        columns={ALL_COLUMNS}
        sortable
        sort="pv"
        onSortChange={onSortChange}
      />,
    );
    const buttons = [...container.querySelectorAll('button')];
    expect(buttons.map((button) => button.textContent)).toEqual([
      '公開日の新しい順',
      '読まれた回数の多い順',
      '最初の 1 週間の多い順',
      '最初の 1 か月の多い順',
    ]);
    expect(buttons.map((button) => button.getAttribute('aria-pressed'))).toEqual([
      'false',
      'true',
      'false',
      'false',
    ]);
    expect(container.textContent).not.toMatch(/少ない|昇順|古い順/);
    expect(container.querySelector('[aria-sort]')).toBeNull();
    // 読まれた回数の多い順。伏せ値の行は後ろ。
    expect(titles(container)).toEqual(['記事 A', '記事 D', '記事 B', '記事 C']);

    fireEvent.click(screen.getByRole('button', { name: '最初の 1 か月の多い順' }));
    expect(onSortChange).toHaveBeenCalledWith('pv30');
  });

  it('sortArticleRows: 多い順だけ。値のない行は後ろ、同じ値は公開日の新しい順', () => {
    const ids = (sort: Parameters<typeof sortArticleRows>[1]): number[] =>
      sortArticleRows(ROWS, sort).map((row) => row.post.id);
    expect(ids('published')).toEqual([202, 201, 204, 203]);
    expect(ids('pv')).toEqual([201, 204, 202, 203]);
    expect(ids('pv7')).toEqual([201, 204, 202, 203]);
    expect(ids('pv30')).toEqual([201, 204, 202, 203]);
  });

  it('狭い画面用の 4 列を残し、残りは行の末尾の「詳しく」に入る', () => {
    const { container } = render(
      <ArticleTable caption="記事" rows={ROWS} columns={ALL_COLUMNS} narrowColumns={NARROW} />,
    );
    const kept = [...container.querySelectorAll('thead th')].filter(
      (item) => !hasClass(item, 'wideOnly'),
    );
    expect(kept.map((item) => item.textContent)).toEqual([
      '記事',
      '公開日',
      '読まれた回数',
      '最初の 1 か月',
    ]);
    for (const row of bodyRows(container)) {
      expect([...row.cells].filter((item) => !hasClass(item, 'wideOnly'))).toHaveLength(4);
    }

    const moreRows = [...container.querySelectorAll<HTMLTableRowElement>('tbody > tr')].filter(
      (row) => row.querySelector('details') !== null,
    );
    expect(moreRows).toHaveLength(ROWS.length);
    const first = moreRows[0];
    expect(first !== undefined && hasClass(first, 'narrowOnly')).toBe(true);
    expect(first?.cells[0]?.colSpan).toBe(4);
    expect(first?.querySelector('details')?.hasAttribute('open')).toBe(false);
    expect(first?.querySelector('summary')?.textContent).toContain('詳しく');
    expect([...(first?.querySelectorAll('dt') ?? [])].map((item) => item.textContent)).toEqual([
      'ライター',
      '最初の 1 週間',
      'カテゴリ',
    ]);
    expect([...(first?.querySelectorAll('dd') ?? [])].map((item) => item.textContent)).toEqual([
      '高津 花子',
      '86',
      '記事 > グルメ、記事 > まち歩き',
    ]);
  });

  it('狭い画面に残す列は 4 つまで。列が 4 つ以下なら「詳しく」を作らない', () => {
    const five = render(
      <ArticleTable
        caption="記事"
        rows={ROWS}
        columns={ALL_COLUMNS}
        narrowColumns={['title', 'author', 'publishedOn', 'pageviews', 'pv7']}
      />,
    );
    expect(
      [...five.container.querySelectorAll('thead th')].filter(
        (item) => !hasClass(item, 'wideOnly'),
      ),
    ).toHaveLength(4);
    five.unmount();

    const four = render(
      <ArticleTable
        caption="記事"
        rows={ROWS}
        columns={['title', 'author', 'publishedOn', 'pageviews']}
      />,
    );
    expect(four.container.querySelector('details')).toBeNull();
    expect(four.container.querySelector('[class*="wideOnly"]')).toBeNull();
  });

  it('著者の slug は href にだけあり、文字として現れない。slug が null の著者はリンクでない', () => {
    const { container } = render(<ArticleTable caption="記事" rows={ROWS} columns={ALL_COLUMNS} />);
    expect(container.textContent).not.toContain('writer-a');
    const rows = bodyRows(container);
    const authorLink = rows[0]?.cells[1]?.querySelector('a');
    expect(authorLink?.getAttribute('href')).toBe('/authors/writer-a');
    expect(authorLink?.textContent).toBe('高津 花子');

    const noPage = rows[3]?.cells[1];
    expect(noPage?.textContent).toBe('溝口 太郎');
    expect(noPage?.querySelector('a')).toBeNull();
  });

  it('タイトルは記事詳細へのリンク。右に、記事ページへの「↗」の外部リンク', () => {
    const { container } = render(<ArticleTable caption="記事" rows={ROWS} columns={ALL_COLUMNS} />);
    const anchors = [...(bodyRows(container)[0]?.cells[0]?.querySelectorAll('a') ?? [])];
    expect(anchors.map((anchor) => anchor.getAttribute('href'))).toEqual([
      '/articles/201',
      'https://takatsu-connect.com/archives/101',
    ]);
    expect(anchors[1]?.textContent).toBe('↗');
    expect(anchors[1]?.getAttribute('target')).toBe('_blank');
    expect(anchors[1]?.getAttribute('aria-label')).toContain('記事 A');
  });

  it('記事ページの URL が検証を通らなければ、「↗」を描かない', () => {
    const rows = [{ post: makePost({ url: 'https://example.com/x' }), pageviews: 10 }];
    const { container } = render(<ArticleTable caption="記事" rows={rows} columns={['title']} />);
    expect(container.querySelector('a[target="_blank"]')).toBeNull();
    expect(container.textContent).not.toContain('↗');
  });

  it('数え始める前に公開した記事のセルは「—」でなく「数え始める前」', () => {
    const { container } = render(
      <ArticleTable caption="記事" rows={ROWS} columns={['title', 'pv7', 'pv30', 'band']} />,
    );
    const texts = cellTexts(bodyRows(container)[2] as HTMLTableRowElement);
    expect(texts.slice(1)).toEqual(['数え始める前', '数え始める前', '数え始める前']);
    expect(texts.join('')).not.toContain('—');
  });

  it('まだ日数がたっていない記事は「◯日目: ◯回」', () => {
    const { container } = render(
      <ArticleTable caption="記事" rows={ROWS} columns={['title', 'pv7', 'pv30', 'band']} />,
    );
    const texts = cellTexts(bodyRows(container)[1] as HTMLTableRowElement);
    expect(texts.slice(1)).toEqual(['4 日目: 41 回', '4 日目: 41 回', 'よく読まれています']);
  });

  it('この期間の読まれた回数が伏せ値なら「—」と「伏せ値」', () => {
    const { container } = render(
      <ArticleTable caption="記事" rows={ROWS} columns={['title', 'pageviews']} />,
    );
    expect(bodyRows(container)[2]?.cells[1]?.querySelector('.masked')?.textContent).toBe('—伏せ値');
  });

  it('帯の図は、呼び出し側の描画関数で差し込む。数え始める前の記事では呼ばない', () => {
    const renderBand = vi.fn((post: { id: number }) => <i data-band={post.id} />);
    const { container } = render(
      <ArticleTable
        caption="記事"
        rows={ROWS}
        columns={['title', 'publishedOn', 'pv30', 'band', 'author']}
        narrowColumns={['title', 'publishedOn', 'pv30', 'band']}
        renderBand={renderBand}
      />,
    );
    const calledIds = new Set(renderBand.mock.calls.map(([post]) => post.id));
    expect([...calledIds].sort()).toEqual([201, 202, 204]);
    // 広い画面では図、狭い画面では文言だけ。図は「詳しく」にも入る。
    const bandCell = bodyRows(container)[0]?.cells[3];
    expect(bandCell?.querySelector('[class*="wideOnly"] [data-band="201"]')).not.toBeNull();
    expect(bandCell?.querySelector('[class*="narrowOnly"]')?.textContent).toBe(
      '多くの記事と同じくらい',
    );
    expect(container.querySelector('details [data-band="201"]')).not.toBeNull();
    expect(container.querySelector('[data-band="203"]')).toBeNull();
  });

  it('印は指定した種類だけ。「久しぶりに読まれた」は「最近読まれている」より先に立つ', () => {
    const rows: ArticleTableRow[] = [
      { post: makePost({ id: 1, title: '記事 E', freshness: 'new', isRecentHot: true }) },
      { post: makePost({ id: 2, title: '記事 F', isRecentHot: true, isRevival: true }) },
    ];
    const first = render(<ArticleTable caption="記事" rows={rows} columns={['title']} />);
    expect(first.container.textContent).toContain('新着');
    expect(first.container.textContent).not.toContain('最近読まれている');
    first.unmount();

    const { container } = render(
      <ArticleTable
        caption="記事"
        rows={rows}
        columns={['title']}
        badges={['recentHot', 'revival']}
      />,
    );
    const texts = bodyRows(container).map((row) => row.textContent ?? '');
    expect(texts[0]).toContain('最近読まれている');
    expect(texts[0]).not.toContain('新着');
    expect(texts[1]).toContain('久しぶりに読まれた');
    expect(texts[1]).not.toContain('最近読まれている');
  });

  it('100 件を超えるときは 50 件ずつ「さらに表示」', () => {
    const many: ArticleTableRow[] = [...new Array(120).keys()].map((index) => ({
      post: makePost({ id: 1000 + index, title: `記事 ${String.fromCharCode(65 + (index % 26))}` }),
      pageviews: 500,
    }));
    const { container } = render(
      <ArticleTable caption="記事" rows={many} columns={['title', 'pageviews']} />,
    );
    expect(bodyRows(container)).toHaveLength(50);
    expect(container.textContent).toContain('120 件のうち 50 件を表示しています');
    fireEvent.click(screen.getByRole('button', { name: 'さらに表示' }));
    expect(bodyRows(container)).toHaveLength(100);
    fireEvent.click(screen.getByRole('button', { name: 'さらに表示' }));
    expect(bodyRows(container)).toHaveLength(120);
    expect(screen.queryByRole('button', { name: 'さらに表示' })).toBeNull();
  });

  it('100 件以下なら、すべて描く', () => {
    const some: ArticleTableRow[] = [...new Array(100).keys()].map((index) => ({
      post: makePost({ id: 2000 + index }),
    }));
    const { container } = render(<ArticleTable caption="記事" rows={some} columns={['title']} />);
    expect(bodyRows(container)).toHaveLength(100);
    expect(container.querySelector('button')).toBeNull();
  });

  it('行がないときは、データなしの文を出す', () => {
    const { container } = render(
      <ArticleTable
        caption="記事"
        rows={[]}
        columns={ALL_COLUMNS}
        emptyText="この期間に公開された記事はありません"
      />,
    );
    expect(container.querySelector('table')).toBeNull();
    expect(container.textContent).toBe('この期間に公開された記事はありません');
  });
});
