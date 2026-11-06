import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { S02aScreen } from '@/screens/s02/S02aScreen';
import { S02cScreen } from '@/screens/s02/S02cScreen';

import { makePost } from '../../components/fixtures';

import { cellText, headers, listData, makeListData, rowTitles, setUrl } from './helpers';

/** 30 本の記事。直近 28 日は添字の順、直近 7 日はその逆の順に多く読まれた。 */
function thirtyPosts() {
  const posts = [...Array(30).keys()].map((index) =>
    makePost({ id: 300 + index, title: `朝市の記事 ${index + 1}` }),
  );
  const ascending = posts.map((_, index) => index);
  return makeListData({
    posts,
    pvByPeriod: {
      last28: posts.map((_, index) => 500 - index),
      last7: posts.map((_, index) => 10 + index),
    },
    topIndex: { last28: ascending, last7: [...ascending].reverse() },
  });
}

beforeEach(() => {
  setUrl('/articles/top');
});

describe('S-02a よく読まれた記事', () => {
  it('問いの見出し、注記、4 つの列を描く', () => {
    const { container } = render(<S02aScreen data={listData('top')} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'この期間、どの記事がよく読まれた？',
    );
    expect(
      screen.getByText(
        '公開したばかりの記事は、多く出やすくなります。記事以外のページと広告の記事は含めていません。',
      ),
    ).toBeTruthy();
    expect(headers(container)).toEqual(['記事', 'ライター', '公開日', '読まれた回数']);
    expect(screen.getByRole('group', { name: '期間' })).toBeTruthy();
  });

  it('直近 28 日に読まれた回数の多い順に並び、広告の記事を含まない', () => {
    const { container } = render(<S02aScreen data={listData('top')} />);
    expect(rowTitles(container)).toEqual([
      '記事 106',
      '記事 101',
      '記事 103',
      '記事 102',
      '記事 104',
    ]);
    expect(cellText(container, '記事 106', '読まれた回数')).toBe('200');
    expect(container.textContent).not.toContain('記事 105');
  });

  it('期間を変えると並びが変わり、URL に書き戻す', () => {
    const { container } = render(<S02aScreen data={listData('top')} />);
    fireEvent.click(screen.getByRole('button', { name: '直近 7 日' }));
    expect(rowTitles(container)).toEqual([
      '記事 106',
      '記事 103',
      '記事 101',
      '記事 104',
      '記事 102',
    ]);
    expect(cellText(container, '記事 106', '読まれた回数')).toBe('90');
    expect(window.location.search).toBe('?p=last7');
  });

  it('件数の切り替えで行数が変わる', () => {
    const { container } = render(<S02aScreen data={thirtyPosts()} />);
    expect(rowTitles(container)).toHaveLength(20);
    expect(screen.getByRole('button', { name: '20 件' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: '50 件' }));
    expect(rowTitles(container)).toHaveLength(30);
    expect(window.location.search).toBe('?n=50');

    fireEvent.click(screen.getByRole('button', { name: '20 件' }));
    expect(rowTitles(container)).toHaveLength(20);
    expect(window.location.search).toBe('');
  });

  it('URL の n と p を読む。許されない値は既定に戻す', () => {
    setUrl('/articles/top?n=50&p=last7');
    const first = render(<S02aScreen data={thirtyPosts()} />);
    expect(rowTitles(first.container)).toHaveLength(30);
    expect(rowTitles(first.container)[0]).toBe('朝市の記事 30');
    first.unmount();

    setUrl('/articles/top?n=1000&p=last365');
    const second = render(<S02aScreen data={thirtyPosts()} />);
    expect(rowTitles(second.container)).toHaveLength(20);
    expect(rowTitles(second.container)[0]).toBe('朝市の記事 1');
  });

  it('並べ替えの UI がない（URL の sort も効かない）', () => {
    setUrl('/articles/top?sort=pv7');
    const { container } = render(<S02aScreen data={listData('top')} />);
    expect(screen.queryByRole('group', { name: '並び' })).toBeNull();
    expect(screen.queryByRole('button', { name: /順/ })).toBeNull();
    expect(rowTitles(container)[0]).toBe('記事 106');
  });

  it('公開から 1 か月以内の記事に「新着」の印を付ける', () => {
    const { container } = render(<S02aScreen data={listData('top')} />);
    expect(cellText(container, '記事 104', '記事')).toContain('新着');
    expect(cellText(container, '記事 106', '記事')).not.toContain('新着');
  });

  it('その期間に読まれた記事がなければ、データなしの文を出す', () => {
    const { container } = render(
      <S02aScreen data={makeListData({ pvByPeriod: { last28: [] }, topIndex: { last28: [] } })} />,
    );
    expect(screen.getByText('この期間の数字はまだありません。')).toBeTruthy();
    expect(container.querySelector('table')).toBeNull();
  });

  it('選べる期間が 1 つもなければ、期間の選択を描かずにデータなしの文を出す', () => {
    render(<S02aScreen data={makeListData({ periods: [] })} />);
    expect(screen.getByText('この期間の数字はまだありません。')).toBeTruthy();
    expect(screen.queryByRole('group', { name: '期間' })).toBeNull();
  });
});

describe('S-02c 長く読まれている記事', () => {
  it('公開から 91 日以上たった記事だけを、読まれた回数の多い順に並べる', () => {
    const { container } = render(<S02cScreen data={listData('long')} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      '公開から 3 か月以上たっても読まれている記事は？',
    );
    expect(
      screen.getByText('公開から 91 日以上たった記事のうち、この期間に読まれた回数が多いものです'),
    ).toBeTruthy();
    expect(headers(container)).toEqual(['記事', 'ライター', '公開日', '読まれた回数']);
    expect(rowTitles(container)).toEqual(['記事 106', '記事 101', '記事 102']);
  });

  it('期間と件数を選べて、並べ替えの UI がない', () => {
    const { container } = render(<S02cScreen data={listData('long')} />);
    expect(screen.getByRole('group', { name: '件数' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: '並び' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '直近 7 日' }));
    expect(rowTitles(container)).toEqual(['記事 106', '記事 101', '記事 102']);
    expect(cellText(container, '記事 102', '読まれた回数')).toBe('5');
  });
});
