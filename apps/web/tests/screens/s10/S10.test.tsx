/**
 * S-10a〜S-10e（イベント記事。S-02a〜S-02e のイベント記事版）と、記事の種類に関わる
 * ほかの画面の表示（S-06 の子カテゴリのリンク、S-03 の比べる相手の一言）。2026-11-10。
 */
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { buildArticleDetail, buildCategories } from '@/data/pages';
import { ARTICLE_CATEGORY_ID, EVENT_CATEGORY_ID } from '@/lib/config';
import { ArticleDetailScreen } from '@/screens/s03/ArticleDetailScreen';
import { S02aScreen } from '@/screens/s02/S02aScreen';
import { S02bScreen } from '@/screens/s02/S02bScreen';
import { S02cScreen } from '@/screens/s02/S02cScreen';
import { S02dScreen } from '@/screens/s02/S02dScreen';
import { S02eScreen } from '@/screens/s02/S02eScreen';
import { CategoriesScreen } from '@/screens/s06/CategoriesScreen';

import { BUILT_AT, EVENT_ONLY_POST_ID, makeCache, withEventOnly } from '../../data/fixture';
import { AVOIDED_WORDS, listData, rowTitles, setUrl } from '../s02/helpers';

beforeEach(() => {
  setUrl('/events/top');
});

describe('S-10a〜S-10e イベント記事', () => {
  it.each([
    [
      'S-10a',
      () => <S02aScreen data={listData('top', 'event')} />,
      'この期間、どのイベント記事がよく読まれた？',
    ],
    [
      'S-10b',
      () => <S02bScreen data={listData('new', 'event')} />,
      'この期間に公開されたイベント記事は、どう読まれ始めた？',
    ],
    [
      'S-10c',
      () => <S02cScreen data={listData('long', 'event')} />,
      '公開から 3 か月以上たっても読まれているイベント記事は？',
    ],
    [
      'S-10d',
      () => <S02dScreen data={listData('recent', 'event')} />,
      '最近よく読まれているイベント記事は？',
    ],
    ['S-10e', () => <S02eScreen data={listData('search', 'event')} />, 'イベント記事を探す'],
  ])('%s: h1 は「記事」を「イベント記事」に置き換えた問い。使わない語がない', (_, draw, h1) => {
    const { container } = render(draw());
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(h1);
    const text = container.textContent ?? '';
    for (const word of AVOIDED_WORDS) expect(text).not.toContain(word);
    expect(text).not.toContain('出ません');
  });

  it('S-10a: イベントに属する記事だけを並べる（103 は記事とイベントの両方、106 はイベント）', () => {
    const { container } = render(<S02aScreen data={listData('top', 'event')} />);
    expect([...rowTitles(container)].sort()).toEqual(['記事 103', '記事 106']);
    // 件数の切り替えは記事タブと同じ。
    expect(screen.getByRole('group', { name: '件数' })).toBeTruthy();
  });

  it('S-10e: カテゴリの選択肢はイベントの親とその子だけ', () => {
    setUrl('/events');
    render(<S02eScreen data={listData('search', 'event')} />);
    const options = [...screen.getByLabelText('カテゴリ').querySelectorAll('option')].map(
      (option) => option.textContent,
    );
    expect(options).toEqual(['すべて', 'イベント']);
  });

  it('S-10e: 記事の親の cat は許可リストにないので無視する', () => {
    setUrl(`/events?cat=${ARTICLE_CATEGORY_ID}`);
    const { container } = render(<S02eScreen data={listData('search', 'event')} />);
    expect(rowTitles(container)).toHaveLength(2);
    expect((screen.getByLabelText('カテゴリ') as HTMLSelectElement).value).toBe('');
  });

  it('S-10e: イベントの親の cat で絞れる', () => {
    setUrl(`/events?cat=${EVENT_CATEGORY_ID}`);
    const { container } = render(<S02eScreen data={listData('search', 'event')} />);
    expect([...rowTitles(container)].sort()).toEqual(['記事 103', '記事 106']);
    expect(window.location.search).toBe(`?cat=${EVENT_CATEGORY_ID}`);
  });

  it('S-10c: 件数の n=50 を URL から読む（S-02c と同じ許可リスト）', () => {
    setUrl('/events/long?n=50');
    render(<S02cScreen data={listData('long', 'event')} />);
    const group = screen.getByRole('group', { name: '件数' });
    expect(within(group).getByRole('button', { pressed: true }).textContent).toContain('50');
  });
});

describe('S-06 子カテゴリのリンクの行き先（記事の種類ごと）', () => {
  it('記事の子は /articles?cat=、イベントの子は /events?cat=、マップと広告の子はリンクにしない', () => {
    setUrl('/categories?p=last7');
    const cache = makeCache();
    // イベントの下に子カテゴリを 1 つ足す（同じ名前「グルメ」）。
    cache.categories.push({
      category_id: 30,
      name: 'グルメ',
      parent_id: EVENT_CATEGORY_ID,
      path: 'イベント > グルメ',
    });
    cache.categoryPeriod.push({
      category_id: 30,
      period_id: 'last7',
      pageviews: 40,
      post_count_total: 1,
      post_count_published: 0,
      median_30d_pv: null,
      published_post_count_30d: 0,
    });
    // 広告の子（PR）にも、この期間の行を置く（行がないと表に出ない）。
    cache.categoryPeriod.push({
      category_id: 6,
      period_id: 'last7',
      pageviews: 20,
      post_count_total: 1,
      post_count_published: 0,
      median_30d_pv: null,
      published_post_count_30d: 0,
    });
    const { container } = render(<CategoriesScreen data={buildCategories(cache, BUILT_AT)} />);

    const hrefs = [...container.querySelectorAll('a')].map((link) => link.getAttribute('href'));
    expect(hrefs).toContain('/articles?cat=3');
    expect(hrefs).toContain('/events?cat=30');
    // 広告の子（PR）は、文字だけ。
    expect(screen.queryByRole('link', { name: 'PR' })).toBeNull();
    expect(container.textContent).toContain('PR');
  });
});

describe('S-03 何と比べているかの一言', () => {
  it('イベントだけの記事は「イベント記事どうし」、記事に属する記事は「記事どうし」', () => {
    const cache = withEventOnly(makeCache());
    const event = buildArticleDetail(cache, EVENT_ONLY_POST_ID, BUILT_AT);
    const both = buildArticleDetail(cache, 102, BUILT_AT);
    if (event === null || both === null) throw new Error('fixture');

    const first = render(<ArticleDetailScreen data={event} />);
    expect(first.container.textContent).toContain(
      '比べる相手は、イベント記事どうし（広告を除く）です。',
    );
    first.unmount();

    const second = render(<ArticleDetailScreen data={both} />);
    expect(second.container.textContent).toContain('比べる相手は、記事どうし（広告を除く）です。');
  });

  it('帯を描くときは、帯の文が「まだ比較できません」でも一言を出し、凡例の直下（帯の文の前）に置く（M-4）', () => {
    const cache = withEventOnly(makeCache());
    const event = buildArticleDetail(cache, EVENT_ONLY_POST_ID, BUILT_AT);
    if (event === null) throw new Error('fixture');
    const noSentence = { ...event, post: { ...event.post, pv30: null } };
    const { container } = render(<ArticleDetailScreen data={noSentence} />);
    const section = container.querySelector('section[aria-labelledby="s03-curve"]');
    const texts = [...(section?.querySelectorAll('p') ?? [])].map((item) => item.textContent);
    const scope = texts.indexOf('比べる相手は、イベント記事どうし（広告を除く）です。');
    const absent = texts.indexOf('まだ比較できません');
    expect(scope).toBeGreaterThanOrEqual(0);
    expect(absent).toBe(scope + 1);
    // 凡例（ul）の直後の要素が一言。
    expect(
      section?.querySelector('ul')?.closest('div,figure')?.nextElementSibling?.textContent,
    ).toBe('比べる相手は、イベント記事どうし（広告を除く）です。');
  });

  it('比べられない（曲線がない）ときは、比べる相手の一言を出さない', () => {
    const cache = withEventOnly(makeCache());
    cache.benchmarkCurve = cache.benchmarkCurve.filter((row) => row.scope !== 'kind:event');
    const event = buildArticleDetail(cache, EVENT_ONLY_POST_ID, BUILT_AT);
    if (event === null) throw new Error('fixture');
    const { container } = render(<ArticleDetailScreen data={event} />);
    expect(container.textContent).not.toContain('比べる相手は');
  });
});
