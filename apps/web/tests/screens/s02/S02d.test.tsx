import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { S02dScreen } from '@/screens/s02/S02dScreen';

import { makePost } from '../../components/fixtures';

import { cellText, headers, listData, makeListData, rowTitles, setUrl } from './helpers';

beforeEach(() => {
  setUrl('/articles/recent');
});

describe('S-02d 最近よく読まれている記事', () => {
  it('問いの見出し、注記と「詳しく」、4 つの列を描く', () => {
    const { container } = render(<S02dScreen data={listData('recent')} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      '最近よく読まれている記事は？',
    );
    expect(
      screen.getByText('直近 1 週間に、その前の数週間よりはっきり多く読まれた記事です（目安）。'),
    ).toBeTruthy();
    const details = container.querySelector('details');
    expect(details?.querySelector('summary')?.textContent).toBe('詳しく');
    expect(details?.textContent).toContain('公開から 15 日以上たち');
    expect(details?.hasAttribute('open')).toBe(false);
    expect(headers(container)).toEqual(['記事', 'ライター', '公開日', '直近 7 日の読まれた回数']);
  });

  it('期間の選択がなく、URL の p も効かない', () => {
    setUrl('/articles/recent?p=m2026-10');
    const { container } = render(<S02dScreen data={listData('recent')} />);
    expect(screen.queryByRole('group', { name: '期間' })).toBeNull();
    expect(screen.queryByRole('group', { name: '並び' })).toBeNull();
    expect(screen.queryAllByRole('button')).toEqual([]);
    expect(container.querySelector('select')).toBeNull();
    expect(cellText(container, '記事 106', '直近 7 日の読まれた回数')).toBe('90');
  });

  it('直近 7 日に読まれた回数の多い順に並べ、印を付ける。広告の記事を含まない', () => {
    const { container } = render(<S02dScreen data={listData('recent')} />);
    expect(rowTitles(container)).toEqual(['記事 106', '記事 103', '記事 101', '記事 104']);
    expect(cellText(container, '記事 106', '記事')).toContain('久しぶりに読まれた');
    expect(cellText(container, '記事 103', '記事')).toContain('最近読まれている');
    expect(cellText(container, '記事 103', '記事')).not.toContain('久しぶりに読まれた');
    expect(container.textContent).not.toContain('記事 105');
  });

  it('最大 10 件', () => {
    const posts = [...Array(12).keys()].map((index) =>
      makePost({ id: 600 + index, title: `祭りの記事 ${index + 1}`, isRecentHot: true }),
    );
    const data = makeListData({
      posts,
      pvByPeriod: { last7: posts.map((_, index) => 20 + index) },
    });
    const { container } = render(<S02dScreen data={data} />);
    expect(rowTitles(container)).toHaveLength(10);
    // 多い順。添字の大きい記事ほど多く読まれている。
    expect(rowTitles(container)[0]).toBe('祭りの記事 12');
    expect(rowTitles(container)[9]).toBe('祭りの記事 3');
  });

  it('該当がなければ、その旨の文を出す', () => {
    const { container } = render(<S02dScreen data={makeListData({ pvByPeriod: { last7: [] } })} />);
    expect(screen.getByText('今週は該当する記事がありません')).toBeTruthy();
    expect(container.querySelector('table')).toBeNull();
  });

  it('何倍になったかの数字を表に出さない', () => {
    const { container } = render(<S02dScreen data={listData('recent')} />);
    const table = container.querySelector('table');
    expect(table).not.toBeNull();
    expect(table?.textContent).not.toContain('倍');
    expect(table?.textContent).not.toMatch(/[×x]\s*\d/);
  });
});
