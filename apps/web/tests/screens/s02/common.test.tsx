import { render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';

import { t } from '@/lib/ui-text';
import { S02aScreen } from '@/screens/s02/S02aScreen';
import { S02bScreen } from '@/screens/s02/S02bScreen';
import { S02cScreen } from '@/screens/s02/S02cScreen';
import { S02dScreen } from '@/screens/s02/S02dScreen';
import { S02eScreen } from '@/screens/s02/S02eScreen';

import { makePost } from '../../components/fixtures';
import { SATO, TANAKA } from '../../data/fixture';

import {
  AVOIDED_WORDS,
  cellText,
  expectNoNumbering,
  listData,
  makeListData,
  setUrl,
} from './helpers';

const SCREENS = [
  ['S-02a', 'top', S02aScreen, 's02a.h1'],
  ['S-02b', 'new', S02bScreen, 's02b.h1'],
  ['S-02c', 'long', S02cScreen, 's02c.h1'],
  ['S-02d', 'recent', S02dScreen, 's02d.h1'],
  ['S-02e', 'search', S02eScreen, 's02e.h1'],
] as const;

beforeEach(() => {
  setUrl('/');
});

describe.each(SCREENS)('%s の共通の決まり', (_id, kind, Screen, h1Key) => {
  it('h1 が 1 つあり、辞書の見出しと同じ', () => {
    render(<Screen data={listData(kind)} />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(t(h1Key));
  });

  it('連番の列がなく、行の先頭のセルが数字と区切りで始まらない', () => {
    const { container } = render(<Screen data={listData(kind)} />);
    expectNoNumbering(container);
  });

  it('style 属性を出さない', () => {
    // サーバーで描く HTML（文字列。既定の状態）と、ブラウザで描いた DOM の両方を見る。
    const html = renderToStaticMarkup(<Screen data={listData(kind)} />);
    expect(html).toContain('<h1>');
    expect(html).not.toMatch(/\sstyle=/);
    const { container } = render(<Screen data={listData(kind)} />);
    expect(container.querySelector('[style]')).toBeNull();
  });

  it('使わない語が本文にない', () => {
    const { container } = render(<Screen data={listData(kind)} />);
    const text = container.textContent ?? '';
    expect(AVOIDED_WORDS.filter((word) => text.includes(word))).toEqual([]);
    expect(text).not.toMatch(/出ません/);
  });

  it('著者の slug は href にだけあり、本文の文字に現れない', () => {
    const { container } = render(<Screen data={listData(kind)} />);
    const text = container.textContent ?? '';
    expect(text).not.toContain(SATO);
    expect(text).not.toContain(TANAKA);
    expect(container.querySelector(`a[href*="${TANAKA}"]`)).not.toBeNull();
  });
});

describe('数え始める前に公開した記事', () => {
  it('S-02e: セルは「—」でなく「数え始める前」で、表の上に注記が 1 行出る', () => {
    const { container } = render(<S02eScreen data={listData('search')} />);
    expect(cellText(container, '記事 101', '最初の 1 週間')).toBe('数え始める前');
    expect(cellText(container, '記事 101', '最初の 1 か月')).toBe('数え始める前');
    expect(cellText(container, '記事 101', '最初の 1 週間')).not.toContain('—');
    expect(
      screen.getAllByText(
        '「数え始める前」: 2025 年 10 月 8 日より前に公開された記事です。最初の 1 週間と最初の 1 か月の数字は残っていません。',
      ),
    ).toHaveLength(1);
  });

  it('S-02e: 該当の行が表にないときは、注記を出さない', () => {
    setUrl('/articles?ym=2026-10');
    const { container } = render(<S02eScreen data={listData('search')} />);
    expect(container.textContent).not.toContain('数え始める前');
  });

  it('S-02b: 3 つのセルが「数え始める前」で、注記が出る', () => {
    const data = makeListData({
      periods: [
        ...makeListData().periods,
        {
          id: 'm2025-10',
          kind: 'month',
          start: '2025-10-01',
          end: '2025-10-31',
          isConfirmed: true,
          label: '2025 年 10 月',
          prevId: null,
          yoyId: null,
        },
      ],
      posts: [
        makePost({
          id: 501,
          title: '数え始める前の記事',
          publishedOn: '2025-10-03',
          ageDays: 395,
          freshness: 'long',
          isPreMeasure: true,
          pv7: null,
          pv30: null,
          band30: null,
          pvTotal: 640,
        }),
        makePost({
          id: 502,
          title: '数え始めたあとの記事',
          publishedOn: '2025-10-20',
          ageDays: 378,
        }),
      ],
    });
    setUrl('/articles/new?p=m2025-10');
    const { container } = render(<S02bScreen data={data} />);
    for (const header of ['最初の 1 週間', '最初の 1 か月', '多くの記事と比べて']) {
      expect(cellText(container, '数え始める前の記事', header)).toBe('数え始める前');
    }
    expect(cellText(container, '数え始めたあとの記事', '最初の 1 週間')).toBe('86');
    expect(screen.getAllByText(/^「数え始める前」: 2025 年 10 月 8 日より前/)).toHaveLength(1);
    expect(container.textContent).not.toContain('—');
  });

  it('S-02a: 最初の 1 週間などの列がないので、セルにも注記にも「数え始める前」が出ない', () => {
    const data = listData('top');
    expect(data.posts.some((post) => post.isPreMeasure)).toBe(true);
    const { container } = render(<S02aScreen data={data} />);
    expect(container.textContent).not.toContain('数え始める前');
    expect(cellText(container, '記事 101', '読まれた回数')).toBe('150');
  });
});
