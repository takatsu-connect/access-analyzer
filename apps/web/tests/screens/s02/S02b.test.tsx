import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { S02bScreen } from '@/screens/s02/S02bScreen';

import { cellText, headers, listData, rowTitles, setUrl } from './helpers';

beforeEach(() => {
  setUrl('/articles/new');
});

describe('S-02b 新着記事の立ち上がり', () => {
  it('問いの見出し、2 つの注記、6 つの列を描く', () => {
    const { container } = render(<S02bScreen data={listData('new')} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'この期間に公開された記事は、どう読まれ始めた？',
    );
    expect(screen.getByText(/並びは公開日順で、読まれた回数では並べ替えません。$/)).toBeTruthy();
    expect(screen.getByText(/成績ではなく、位置です。$/)).toBeTruthy();
    expect(headers(container)).toEqual([
      '記事',
      'ライター',
      '公開日',
      '最初の 1 週間',
      '最初の 1 か月',
      '多くの記事と比べて',
    ]);
  });

  it('選んだ期間に公開された記事だけを、公開日の新しい順に並べる', () => {
    // 直近 28 日は 2026-10-07〜2026-11-03。記事 103（10/10）と記事 104（11/01）だけが入る。
    const { container } = render(<S02bScreen data={listData('new')} />);
    expect(rowTitles(container)).toEqual(['記事 104', '記事 103']);

    fireEvent.click(screen.getByRole('button', { name: '直近 7 日' }));
    expect(rowTitles(container)).toEqual(['記事 104']);
    expect(window.location.search).toBe('?p=last7');
  });

  it('まだ日数がたっていない列は「◯日目: ◯回」と書く', () => {
    const { container } = render(<S02bScreen data={listData('new')} />);
    // 記事 103 は 25 日目（公開した日を 1 日目と数える）。1 週間は確定、1 か月はまだ。
    expect(cellText(container, '記事 103', '最初の 1 週間')).toBe('80');
    expect(cellText(container, '記事 103', '最初の 1 か月')).toBe('25 日目: 150 回');
    // 記事 104 は 3 日目。
    expect(cellText(container, '記事 104', '最初の 1 週間')).toBe('3 日目: 12 回');
    expect(cellText(container, '記事 104', '最初の 1 か月')).toBe('3 日目: 12 回');
  });

  it('公開から 3 日未満の記事は「まだ比較できません」と書き、帯を描かない', () => {
    const { container } = render(<S02bScreen data={listData('new')} />);
    expect(cellText(container, '記事 104', '多くの記事と比べて')).toBe('まだ比較できません');
  });

  it('帯の点は区分の中央の固定の位置に置き、文言を添える', () => {
    const { container } = render(<S02bScreen data={listData('new')} />);
    expect(cellText(container, '記事 103', '多くの記事と比べて')).toContain(
      '多くの記事と同じくらい',
    );
    const dots = [...container.querySelectorAll('[data-part="dot"]')];
    expect(dots.length).toBeGreaterThan(0);
    expect(new Set(dots.map((dot) => dot.getAttribute('cx')))).toEqual(new Set(['50%']));
  });

  it('帯で並べ替える UI がない（操作は期間の選択だけ）', () => {
    setUrl('/articles/new?sort=pv30');
    const { container } = render(<S02bScreen data={listData('new')} />);
    expect(screen.queryByRole('group', { name: '並び' })).toBeNull();
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button.closest('[role="group"]')?.getAttribute('aria-label')).toBe('期間');
    }
    expect(rowTitles(container)).toEqual(['記事 104', '記事 103']);
  });

  it('期間内に公開された記事がなければ、その旨の文を出す', () => {
    const { container } = render(<S02bScreen data={listData('new')} />);
    fireEvent.change(screen.getByLabelText('月'), { target: { value: 'm2025-10' } });
    expect(screen.getByText('この期間に公開された記事はありません')).toBeTruthy();
    expect(container.querySelector('table')).toBeNull();
  });

  it('広告の記事を含まない', () => {
    const data = listData('new');
    expect(data.posts.some((post) => post.isAd)).toBe(false);
  });
});
