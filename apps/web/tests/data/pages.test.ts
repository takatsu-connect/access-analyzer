/**
 * 組み立て層（src/data/pages）のテスト。手で作った PubCache（tests/data/fixture.ts）から各ページの JSON を作り、
 * 04 §3 の規則と U-21（スキーマを通る。null は伏せ値の列と、型で明示した例外だけ）を確かめる。
 */
import { describe, expect, it } from 'vitest';

import {
  buildActivity,
  buildArticleDetail,
  buildArticleList,
  buildAuthorIndex,
  buildAuthorPage,
  buildCategories,
  buildCommon,
  buildDashboard,
  buildSeasonal,
  buildTagIndex,
  buildTagPage,
  listArticleIds,
  listAuthorSlugs,
  listTagIds,
} from '@/data/pages';
import { MAX_MONTHS, MEASURE_START } from '@/lib/config';
import { formatPeriodLabel } from '@/lib/format';
import type { ArticleListKind } from '@/lib/page-data';
import {
  activityDataSchema,
  articleDetailDataSchema,
  articleListDataSchema,
  authorIndexDataSchema,
  authorPageDataSchema,
  categoryDataSchema,
  dashboardDataSchema,
  seasonalDataSchema,
  tagIndexDataSchema,
  tagPageDataSchema,
} from '@/lib/page-data-schema';
import type { PubPeriod } from '@/lib/pub-types';

import { BUILT_AT, makeCache, SATO, TANAKA } from './fixture';

const LIST_KINDS: ArticleListKind[] = ['top', 'new', 'long', 'recent', 'search'];

describe('buildCommon', () => {
  const common = buildCommon(makeCache(), BUILT_AT);

  it('meta を作る。時刻は JST の文字列にする', () => {
    expect(common.meta).toEqual({
      baseDate: '2026-11-03',
      finishedAt: '2026-11-05T04:12:34+09:00',
      maskThreshold: 5,
      isStale: false,
      measureStart: MEASURE_START,
      builtAt: '2026-11-05T10:02:03+09:00',
    });
  });

  it('選べる期間は、移動窓、月（新しい順）の順。比較用の移動窓は入れない', () => {
    expect(common.periods.map((period) => period.id)).toEqual([
      'last7',
      'last28',
      'm2026-11',
      'm2026-10',
      'm2025-10',
    ]);
  });

  it('前の期間と前年同月は、ある期間だけを指す', () => {
    const byId = new Map(common.periods.map((period) => [period.id, period]));
    expect(byId.get('last7')).toMatchObject({ kind: 'window', prevId: 'prev7', yoyId: null });
    expect(byId.get('last28')).toMatchObject({ prevId: 'prev28', isConfirmed: false });
    expect(byId.get('m2026-11')).toMatchObject({
      kind: 'month',
      start: '2026-11-01',
      end: '2026-11-30',
      isConfirmed: false,
      prevId: 'm2026-10',
      yoyId: null,
    });
    expect(byId.get('m2026-10')).toMatchObject({
      isConfirmed: true,
      prevId: null,
      yoyId: 'm2025-10',
    });
  });

  it('ラベルは formatPeriodLabel の値', () => {
    for (const period of common.periods) expect(period.label).toBe(formatPeriodLabel(period.id));
  });

  it('月は直近 36 か月まで。その外の月は比較の相手にもしない', () => {
    const cache = makeCache();
    const months: PubPeriod[] = [];
    // 2023-08 から 2026-11 までの 40 か月。
    for (let index = 0; index < 40; index += 1) {
      const date = new Date(Date.UTC(2023, 7 + index, 1));
      const month = date.toISOString().slice(0, 7);
      const end = new Date(Date.UTC(2023, 8 + index, 0)).toISOString().slice(0, 10);
      months.push({
        period_id: `m${month}`,
        kind: 'month',
        start_date: `${month}-01`,
        end_date: end,
        is_confirmed: index < 39,
      });
    }
    cache.periods = [...cache.periods.filter((row) => row.kind === 'window'), ...months];

    const periods = buildCommon(cache, BUILT_AT).periods.filter((row) => row.kind === 'month');
    expect(periods).toHaveLength(MAX_MONTHS);
    expect(periods[0]?.id).toBe('m2026-11');
    expect(periods.at(-1)).toMatchObject({ id: 'm2023-12', prevId: null, yoyId: null });
    const byId = new Map(periods.map((period) => [period.id, period]));
    expect(byId.get('m2024-12')).toMatchObject({ prevId: 'm2024-11', yoyId: 'm2023-12' });
    expect(byId.get('m2024-11')).toMatchObject({ prevId: 'm2024-10', yoyId: null });
    expect(byId.get('m2026-01')).toMatchObject({ prevId: 'm2025-12', yoyId: 'm2025-01' });
  });
});

describe('buildDashboard（S-01）', () => {
  const data = buildDashboard(makeCache(), BUILT_AT);

  it('日別の推移と、日ごとの公開本数を同じ範囲で持つ', () => {
    expect(data.daily.firstDay).toBe('2026-10-01');
    expect(data.daily.pageviews).toHaveLength(34);
    expect(data.daily.pageviews.slice(0, 2)).toEqual([100, 101]);
    expect(data.daily.sessions.at(-1)).toBe(83);
    expect(data.publishedPerDay.firstDay).toBe('2026-10-01');
    expect(data.publishedPerDay.counts).toHaveLength(34);
    // 103（10-10）と 104（11-01）。範囲の外に公開した記事は数えない。
    expect(data.publishedPerDay.counts[9]).toBe(1);
    expect(data.publishedPerDay.counts[31]).toBe(1);
    expect(data.publishedPerDay.counts.reduce((sum, count) => sum + count, 0)).toBe(2);
  });

  it('期間の値は、選べる期間と比較の相手（前の期間、前年同月）を持つ', () => {
    expect(Object.keys(data.sitePeriod).sort()).toEqual(
      ['last7', 'prev7', 'last28', 'prev28', 'm2026-11', 'm2026-10', 'm2025-10'].sort(),
    );
    expect(data.sitePeriod.last7).toEqual({
      pageviews: 800,
      sessions: 400,
      activeUsers: 300,
      engagementSeconds: 9000,
      days: 7,
    });
    expect(data.sitePeriod['m2026-11']?.activeUsers).toBeNull();
    expect(data.posting).toMatchObject({ last7: { postCount: 1 }, prev7: { postCount: 0 } });
  });

  it('内訳は全区分を持つ。伏せ値は null、行のない区分は 0', () => {
    expect(data.breakdown.last7).toEqual({
      channel: { search: 200, social: 100, direct: 60, referral: null, other: 0 },
      sns: { instagram: 50, facebook: null, x: 10, line: 5, other: 0 },
      device: {
        mobile: { pageviews: 600, sessions: 300 },
        desktop: { pageviews: 180, sessions: 90 },
        tablet: { pageviews: null, sessions: null },
      },
      local: { kawasaki: 150, japan_other: 200, unknown: 50 },
      newReturning: { new: 250, returning: 140, unknown: 10 },
    });
    expect(data.breakdown.prev7?.channel).toEqual({
      search: 180,
      social: 0,
      direct: 0,
      referral: 0,
      other: 0,
    });
    // 行のない期間はキーごとない。
    expect(data.breakdown).not.toHaveProperty('m2026-10');
  });

  it('時間帯は 168 要素（dow * 24 + hour）', () => {
    const cells = data.heatmap.last7 ?? [];
    expect(cells).toHaveLength(168);
    expect(cells[0]).toBe(5);
    expect(cells[1]).toBeNull();
    expect(cells[2]).toBe(0);
    expect(cells[167]).toBe(9);
    expect(data.heatmap).not.toHaveProperty('last28');
  });

  it('鮮度区分は 3 区分を持つ', () => {
    expect(data.freshness.last7).toEqual({
      new: { postCount: 1, pageviews: 12 },
      mid: { postCount: 0, pageviews: 0 },
      long: { postCount: 3, pageviews: 135 },
    });
  });

  it('参照元と市区は多い順', () => {
    expect(data.monthReferrer).toEqual({
      'm2026-10': [
        { domain: 'google.com', sessions: 500 },
        { domain: 'instagram.com', sessions: 200 },
      ],
    });
    expect(data.monthCity['m2026-10']).toEqual([
      { region: '神奈川県', city: '川崎市', sessions: 300 },
    ]);
  });

  it('分布は n = 30 の行。行がなければ null', () => {
    expect(data.benchmark30).toEqual({
      p25: 100,
      p50: 200,
      p75: 300,
      populationSize: 40,
      populationWindow: '2025-11-03/2026-11-03',
    });
    const cache = makeCache();
    cache.benchmarkCurve = cache.benchmarkCurve.filter((row) => row.n !== 30);
    expect(buildDashboard(cache, BUILT_AT).benchmark30).toBeNull();
  });

  it('日別の行に欠けた日があれば失敗する', () => {
    const cache = makeCache();
    cache.siteDaily = cache.siteDaily.filter((row) => row.day !== '2026-10-15');
    expect(() => buildDashboard(cache, BUILT_AT)).toThrow('pub_site_daily');
  });

  it('定義にない区分の行があれば失敗する', () => {
    const cache = makeCache();
    cache.sitePeriodBreakdown.push({
      period_id: 'last7',
      axis: 'channel',
      bucket: 'sns',
      value: 1,
    });
    expect(() => buildDashboard(cache, BUILT_AT)).toThrow('定義にない区分');
  });
});

describe('buildArticleList（S-02）', () => {
  const cache = makeCache();
  const ids = (kind: ArticleListKind, limits = { top: 2, recent: 2 }) =>
    buildArticleList(cache, kind, BUILT_AT, limits);

  it('posts は post_id の昇順で、列指向の配列も同じ順', () => {
    for (const kind of LIST_KINDS) {
      const data = buildArticleList(cache, kind, BUILT_AT);
      const postIds = data.posts.map((post) => post.id);
      expect(postIds).toEqual([...postIds].sort((a, b) => a - b));
      for (const values of Object.values(data.pvByPeriod ?? {})) {
        expect(values).toHaveLength(data.posts.length);
      }
    }
  });

  it('S-02a: いずれかの期間で上位に入る記事の和集合と、期間ごとの順（広告を除く）', () => {
    const data = ids('top');
    expect(data.posts.map((post) => post.id)).toEqual([101, 103, 106]);
    expect(data.topIndex).toEqual({
      last7: [2, 1],
      // 101 と 103 は同じ回数。post_id の小さいほうを先にする。
      last28: [2, 0],
      'm2026-11': [2, 0],
      'm2026-10': [2, 0],
      'm2025-10': [0],
    });
    expect(data.pvByPeriod?.last7).toEqual([40, 60, 90]);
    expect(data.pvByPeriod?.['m2025-10']).toEqual([300, 0, 0]);
  });

  it('S-02a: 上位 50 までなら、読まれた記事がすべて入る', () => {
    const data = buildArticleList(cache, 'top', BUILT_AT);
    expect(data.posts.map((post) => post.id)).toEqual([101, 102, 103, 104, 106]);
    expect(data.topIndex?.last7).toEqual([4, 2, 0, 3, 1]);
  });

  it('S-02a: 上位 50 を超える記事は、どの期間でも上位でなければ入らない', () => {
    const big = makeCache();
    const template = big.posts.find((post) => post.post_id === 102);
    const templateSummary = big.articleSummary.find((row) => row.post_id === 102);
    if (template === undefined || templateSummary === undefined) throw new Error('fixture');
    for (let id = 1000; id < 1060; id += 1) {
      big.posts.push({ ...template, post_id: id });
      big.articleSummary.push({ ...templateSummary, post_id: id });
      big.articlePeriod.push({
        post_id: id,
        period_id: 'last7',
        pageviews: id,
        landing_sessions: 1,
        scroll_count: 1,
        engagement_seconds: 1,
      });
    }
    const data = buildArticleList(big, 'top', BUILT_AT);
    const top = data.topIndex?.last7 ?? [];
    expect(top).toHaveLength(50);
    expect(top.map((index) => data.posts[index]?.id)).toEqual(
      [...Array(50).keys()].map((offset) => 1059 - offset),
    );
    // 1000〜1009 は last7 の 51 位以下で、ほかの期間の値もない。
    expect(data.posts.some((post) => post.id >= 1000 && post.id <= 1009)).toBe(false);
  });

  it('S-02b: 広告を除く全記事。期間の値は省く', () => {
    const data = ids('new');
    expect(data.posts.map((post) => post.id)).toEqual([101, 102, 103, 104, 106]);
    expect(data).not.toHaveProperty('pvByPeriod');
    expect(data).not.toHaveProperty('topIndex');
  });

  it('S-02c: 長く読まれている記事（freshness = long）だけ', () => {
    const data = ids('long');
    expect(data.posts.map((post) => post.id)).toEqual([101, 106]);
    expect(data.posts.every((post) => post.freshness === 'long')).toBe(true);
    expect(data.topIndex?.last7).toEqual([1, 0]);
    const all = buildArticleList(cache, 'long', BUILT_AT);
    expect(all.posts.map((post) => post.id)).toEqual([101, 102, 106]);
  });

  it('S-02d: 印の付いた記事を、直近 7 日の読まれた回数の多い順に上限まで（広告を除く）', () => {
    // 印があるのは 101、103、104、105（広告）、106。直近 7 日は 106 = 90、103 = 60、101 = 40、104 = 12。
    expect(ids('recent').posts.map((post) => post.id)).toEqual([103, 106]);
    const data = buildArticleList(cache, 'recent', BUILT_AT);
    expect(data.posts.map((post) => post.id)).toEqual([101, 103, 104, 106]);
    expect(data.posts.every((post) => post.isRecentHot || post.isRevival)).toBe(true);
    expect(data).not.toHaveProperty('topIndex');
  });

  it('S-02d: 上限は 10 件', () => {
    const big = makeCache();
    const template = big.posts.find((post) => post.post_id === 103);
    const templateSummary = big.articleSummary.find((row) => row.post_id === 103);
    if (template === undefined || templateSummary === undefined) throw new Error('fixture');
    for (let id = 2000; id < 2015; id += 1) {
      big.posts.push({ ...template, post_id: id });
      big.articleSummary.push({ ...templateSummary, post_id: id });
    }
    expect(buildArticleList(big, 'recent', BUILT_AT).posts).toHaveLength(10);
  });

  it('S-02e: 広告を含む全記事。カテゴリとタグの ID を持つ', () => {
    const data = ids('search');
    expect(data.posts.map((post) => post.id)).toEqual([101, 102, 103, 104, 105, 106]);
    expect(data.posts.find((post) => post.id === 105)).toMatchObject({
      isAd: true,
      categoryIds: [6],
      tagIds: [201],
    });
    expect(data.pvByPeriod?.last7).toEqual([40, 5, 60, 12, 20, 90]);
    // ほかの一覧では空の配列。
    expect(
      ids('new').posts.every((post) => post.categoryIds.length + post.tagIds.length === 0),
    ).toBe(true);
  });

  it('記事ごとの期間の値は、選べる期間だけ（比較用の移動窓を入れない）', () => {
    for (const kind of LIST_KINDS) {
      const data = buildArticleList(cache, kind, BUILT_AT);
      for (const table of [data.pvByPeriod ?? {}, data.topIndex ?? {}]) {
        expect(Object.keys(table).filter((id) => id.startsWith('prev'))).toEqual([]);
      }
    }
  });

  it('数え始める前に公開した記事に印を付ける', () => {
    const posts = ids('search').posts;
    expect(posts.find((post) => post.id === 101)).toMatchObject({
      isPreMeasure: true,
      pv7: null,
      pv30: null,
      band30: null,
      pvTotal: 900,
    });
    expect(posts.filter((post) => post.isPreMeasure).map((post) => post.id)).toEqual([101]);
  });

  it('絞り込みの一覧（カテゴリ、著者の名前順）と分布の 1 行を持つ', () => {
    const data = ids('search');
    expect(data.authors).toEqual([
      { slug: SATO, name: 'さとう はなこ' },
      { slug: 'suzuki_jiro', name: 'すずき じろう' },
      { slug: TANAKA, name: 'たなか たろう' },
    ]);
    expect(data.categories).toHaveLength(5);
    expect(data.categories.find((category) => category.id === 3)).toEqual({
      id: 3,
      name: 'グルメ',
      parentId: 1,
      path: '記事 > グルメ',
    });
    expect(data.benchmark).toEqual({ p25: 100, p50: 200, p75: 300 });
  });
});

describe('buildArticleDetail（S-03）', () => {
  const cache = makeCache();

  it('存在しない記事は null', () => {
    expect(buildArticleDetail(cache, 999, BUILT_AT)).toBeNull();
    expect(buildArticleDetail(cache, Number.NaN, BUILT_AT)).toBeNull();
    expect(buildArticleDetail(cache, 101.5, BUILT_AT)).toBeNull();
  });

  it('listArticleIds は公開記事の post_id（昇順）', () => {
    expect(listArticleIds(cache)).toEqual([101, 102, 103, 104, 105, 106]);
  });

  it('記事の属性、日別、累積、目印、参照元を持つ', () => {
    const data = buildArticleDetail(cache, 102, BUILT_AT);
    if (data === null) throw new Error('102 がない');
    expect(data.post).toMatchObject({
      id: 102,
      authorSlug: SATO,
      isPreMeasure: false,
      pv30: 400,
      band30: 'upper',
      categoryIds: [],
      tagIds: [],
      categories: [{ id: 3, path: '記事 > グルメ' }],
      tags: [{ id: 201, name: 'さんぽ' }],
    });
    // 公開日（2026-01-15）から基準日（2026-11-03）まで。行のない日は 0。
    expect(data.daily.firstDay).toBe('2026-01-15');
    expect(data.daily.pageviews).toHaveLength(293);
    expect(data.daily.pageviews.slice(0, 3)).toEqual([10, 20, 0]);
    expect(data.daily.pageviews.at(-1)).toBe(3);
    expect(data.cumulative).toHaveLength(90);
    expect(data.cumulative.slice(0, 4)).toEqual([10, 30, 45, null]);
    expect(data.milestones).toEqual([
      { milestone: 500, reachedOn: '2026-02-01' },
      { milestone: 1000, reachedOn: '2026-03-01' },
    ]);
    expect(data.referrer30d).toEqual({
      status: 'ready',
      rows: [
        { domain: 'google.com', sessions: 30 },
        { domain: 'instagram.com', sessions: 12 },
      ],
    });
    expect(data.isEvergreen365).toBe(false);
    expect(data.ownMedian30d).toEqual({ value: 230 });
  });

  it('期間の値と内訳は、選べる期間だけ（比較用の移動窓を入れない）', () => {
    const data = buildArticleDetail(cache, 102, BUILT_AT);
    expect(Object.keys(data?.period ?? {}).sort()).toEqual(
      ['last7', 'last28', 'm2026-10', 'm2026-11'].sort(),
    );
    expect(data?.breakdown).toEqual({
      last28: {
        channel: { search: 20, social: null, direct: 5, referral: 0, other: 0 },
        sns: { instagram: null, facebook: 0, x: 0, line: 0, other: 0 },
        device: { mobile: 22, desktop: 6, tablet: 0 },
      },
    });
    expect(buildArticleDetail(cache, 104, BUILT_AT)?.period.last7).toEqual({
      pageviews: 12,
      landingSessions: null,
      scrollCount: null,
      engagementSeconds: 300,
    });
  });

  it('分布の曲線は 90 要素。母集団が足りない n は null', () => {
    const benchmark = buildArticleDetail(cache, 102, BUILT_AT)?.benchmark;
    expect(benchmark?.p50).toHaveLength(90);
    expect(benchmark?.p50.slice(0, 3)).toEqual([2, 4, null]);
    expect(benchmark?.p75[1]).toBe(6.5);
    expect(benchmark?.p25[29]).toBe(100);
    expect(benchmark?.p25.filter((value) => value !== null)).toHaveLength(3);
    expect(benchmark).toMatchObject({ populationSize: 40 });

    const empty = makeCache();
    empty.benchmarkCurve = [];
    expect(buildArticleDetail(empty, 102, BUILT_AT)?.benchmark).toBeNull();
  });

  it('数え始める前に公開した記事: 累積は空、日別は数え始めた日から', () => {
    const data = buildArticleDetail(cache, 101, BUILT_AT);
    expect(data?.post).toMatchObject({ isPreMeasure: true, pv7: null, pv30: null, band30: null });
    expect(data?.cumulative).toEqual([]);
    expect(data?.daily.firstDay).toBe(MEASURE_START);
    expect(data?.daily.pageviews).toHaveLength(392);
    expect(data?.daily.pageviews[0]).toBe(7);
    expect(data?.referrer30d).toEqual({ status: 'pending' });
    expect(data?.isEvergreen365).toBe(true);
  });

  it('公開してすぐの記事: 参照元は pending、著者の中央値がなければ null', () => {
    const data = buildArticleDetail(cache, 104, BUILT_AT);
    expect(data?.referrer30d).toEqual({ status: 'pending' });
    expect(data?.daily).toEqual({ firstDay: '2026-11-01', pageviews: [5, 0, 7] });
    expect(data?.cumulative.slice(0, 4)).toEqual([5, 5, 12, null]);
    expect(data?.ownMedian30d).toBeNull();
    expect(data?.breakdown).toEqual({});
  });

  it('ほかの記事の値を混ぜない', () => {
    const json = JSON.stringify(buildArticleDetail(cache, 104, BUILT_AT));
    for (const other of [101, 102, 103, 105, 106]) expect(json).not.toContain(`記事 ${other}`);
    expect(json).not.toContain(SATO);
  });
});

describe('著者（S-04、S-05）', () => {
  const cache = makeCache();

  it('listAuthorSlugs は決まった形の slug だけ', () => {
    expect(listAuthorSlugs(cache)).toEqual([SATO, TANAKA]);
  });

  it('著者一覧は名前の順で、数値を持たない', () => {
    const data = buildAuthorIndex(cache, BUILT_AT);
    expect(data.authors).toEqual([
      { slug: SATO, name: 'さとう はなこ', url: `https://takatsu-connect.com/author/${SATO}/` },
      { slug: TANAKA, name: 'たなか たろう', url: `https://takatsu-connect.com/author/${TANAKA}/` },
    ]);
  });

  it('存在しない著者、決まった形でない slug は null', () => {
    expect(buildAuthorPage(cache, 'nobody', BUILT_AT)).toBeNull();
    expect(buildAuthorPage(cache, 'suzuki_jiro', BUILT_AT)).toBeNull();
    expect(buildAuthorPage(cache, '../etc', BUILT_AT)).toBeNull();
  });

  it('著者の期間の値、内訳、カテゴリの構成、まとめを持つ', () => {
    const data = buildAuthorPage(cache, SATO, BUILT_AT);
    if (data === null) throw new Error('著者がない');
    expect(data.author.name).toBe('さとう はなこ');
    expect(Object.keys(data.period).sort()).toEqual(['last28', 'last7', 'prev7']);
    expect(data.period.last7).toEqual({
      postCount: 0,
      pageviews: 65,
      longPostCount: 2,
      longPageviews: 45,
    });
    expect(data.breakdown).toEqual({
      last7: {
        channel: { search: 30, social: null, direct: 0, referral: 0, other: 0 },
        sns: { instagram: null, facebook: 0, x: 0, line: 0, other: 0 },
      },
    });
    expect(data.categoryMix).toEqual({
      last7: [
        { categoryId: 3, path: '記事 > グルメ', postCount: 2, pageviews: 45 },
        { categoryId: 6, path: '広告 > PR', postCount: 1, pageviews: 20 },
      ],
    });
    expect(data.summary).toEqual({ ownMedian30d: 230, eligibleCount: 5, band30: 'middle' });
    expect(data.milestones).toEqual([
      { postId: 102, milestone: 500, reachedOn: '2026-02-01' },
      { postId: 102, milestone: 1000, reachedOn: '2026-03-01' },
    ]);
    expect(data.benchmark).toEqual({ p25: 100, p50: 200, p75: 300 });
  });

  it('siteBreakdown は、サイト全体の流入チャネルと SNS', () => {
    const data = buildAuthorPage(cache, TANAKA, BUILT_AT);
    expect(data?.siteBreakdown.last7).toEqual({
      channel: { search: 200, social: 100, direct: 60, referral: null, other: 0 },
      sns: { instagram: 50, facebook: null, x: 10, line: 5, other: 0 },
    });
    expect(Object.keys(data?.siteBreakdown ?? {}).sort()).toEqual(['last28', 'last7', 'prev7']);
    // 著者の内訳に行がなければ、キーごとない。
    expect(data?.breakdown).toEqual({});
    expect(data?.summary).toEqual({ ownMedian30d: null, eligibleCount: 2, band30: null });
  });

  it('記事と、記事ごとの値（選べる期間だけ。posts と同じ順）', () => {
    const data = buildAuthorPage(cache, TANAKA, BUILT_AT);
    expect(data?.posts.map((post) => post.id)).toEqual([103, 104, 106]);
    expect(data?.pvByPeriod.last7).toEqual([60, 12, 90]);
    expect(Object.keys(data?.pvByPeriod ?? {}).filter((id) => id.startsWith('prev'))).toEqual([]);
    // 103 は social が最多、104 は行がない、106 は全区分が伏せ値。
    expect(data?.topChannelByPeriod.last7).toEqual(['social', null, null]);
    expect(data?.topChannelByPeriod.last28).toEqual([null, null, null]);
  });

  it('ほかの著者の記事や値を混ぜない', () => {
    const data = buildAuthorPage(cache, SATO, BUILT_AT);
    expect(data?.posts.map((post) => post.id)).toEqual([101, 102, 105]);
    const json = JSON.stringify(data);
    expect(json).not.toContain(TANAKA);
    expect(json).not.toContain('たなか');
  });
});

describe('カテゴリ（S-06、S-06b）', () => {
  const cache = makeCache();

  it('軸は親の ID の順で、広告を最後に置く', () => {
    const data = buildCategories(cache, BUILT_AT);
    expect(data.axes).toEqual([
      { parent: { id: 1, name: '記事' }, children: [{ id: 3, name: 'グルメ' }] },
      { parent: { id: 7, name: 'イベント' }, children: [] },
      { parent: { id: 5, name: '広告' }, children: [{ id: 6, name: 'PR' }] },
    ]);
  });

  it('期間 → カテゴリ → 値', () => {
    const data = buildCategories(cache, BUILT_AT);
    expect(Object.keys(data.period).sort()).toEqual(['last7', 'm2025-10', 'm2026-10']);
    expect(data.period['m2026-10']?.[3]).toEqual({
      pageviews: 175,
      postCountTotal: 3,
      postCountPublished: 0,
      median30: 210.5,
      median30Count: 2,
    });
    expect(data.period.last7?.[7]?.median30).toBeNull();
  });

  it('季節: 月は古い順。月ごとの読まれた回数', () => {
    const data = buildSeasonal(cache, BUILT_AT);
    expect(data.months).toEqual(['m2025-10', 'm2026-10', 'm2026-11']);
    expect(data.pvByMonth).toEqual({
      3: { 'm2025-10': 300, 'm2026-10': 175 },
      7: { 'm2026-10': 328 },
    });
    expect(data.axes).toHaveLength(3);
  });
});

describe('タグ（S-07、S-07b）', () => {
  const cache = makeCache();

  it('listTagIds は、記事が 1 本以上あるタグだけ', () => {
    expect(listTagIds(cache)).toEqual([201, 202]);
  });

  it('タグの一覧は名前の順。記事が 0 本のタグは入れない', () => {
    const data = buildTagIndex(cache, BUILT_AT);
    expect(data.tags).toEqual([
      { id: 201, name: 'さんぽ' },
      { id: 202, name: 'なつまつり' },
    ]);
    expect(data.period.last7).toEqual({
      201: { pageviews: 65, postCount: 3 },
      202: { pageviews: 60, postCount: 1 },
    });
    expect(data.period.prev7).toEqual({ 201: { pageviews: 40, postCount: 3 } });
  });

  it('記事が 0 本のタグ、存在しないタグは null', () => {
    expect(buildTagPage(cache, 203, BUILT_AT)).toBeNull();
    expect(buildTagPage(cache, 999, BUILT_AT)).toBeNull();
  });

  it('タグのページは、そのタグの記事と値だけ', () => {
    const data = buildTagPage(cache, 201, BUILT_AT);
    expect(data?.tag).toEqual({ id: 201, name: 'さんぽ' });
    expect(data?.posts.map((post) => post.id)).toEqual([101, 102, 105]);
    expect(data?.pvByPeriod.last7).toEqual([40, 5, 20]);
    expect(data?.period).toEqual({
      last7: { 201: { pageviews: 65, postCount: 3 } },
      prev7: { 201: { pageviews: 40, postCount: 3 } },
      'm2026-10': { 201: { pageviews: 225, postCount: 3 } },
    });
  });
});

describe('buildActivity（S-08）', () => {
  const data = buildActivity(makeCache(), BUILT_AT);

  it('月ごとの公開本数。行のない月は 0 本', () => {
    expect(data.monthly).toHaveLength(18);
    expect(data.monthly[0]).toEqual({ month: '2025-06', postCount: 1 });
    expect(data.monthly[1]).toEqual({ month: '2025-07', postCount: 0 });
    expect(data.monthly.at(-1)).toEqual({ month: '2026-11', postCount: 1 });
  });

  it('月は直近 24 か月まで', () => {
    const cache = makeCache();
    cache.postingMonthly.push({ month: '2020-01-01', post_count: 3 });
    const monthly = buildActivity(cache, BUILT_AT).monthly;
    expect(monthly).toHaveLength(24);
    expect(monthly[0]?.month).toBe('2024-12');
  });

  it('著者別の公開本数は、期間内に 1 本以上公開した著者だけを名前の順で', () => {
    expect(data.authorCounts.last7).toEqual([
      { name: 'たなか たろう', slug: TANAKA, postCount: 1 },
    ]);
    expect(data.authorCounts.last28).toEqual([
      { name: 'さとう はなこ', slug: SATO, postCount: 1 },
      { name: 'たなか たろう', slug: TANAKA, postCount: 2 },
    ]);
    // 行のない期間は空の配列。
    expect(data.authorCounts['m2026-10']).toEqual([]);
    expect(Object.keys(data.authorCounts).filter((id) => id.startsWith('prev'))).toEqual([]);
  });

  it('公開本数と、カテゴリ別の公開本数（1 本以上のカテゴリだけ）', () => {
    expect(data.posting).toMatchObject({ last7: { postCount: 1 }, prev28: { postCount: 1 } });
    expect(data.categoryMix.last7).toEqual([
      { categoryId: 1, path: '記事', postCountPublished: 1 },
      { categoryId: 3, path: '記事 > グルメ', postCountPublished: 1 },
    ]);
    expect(data.categoryMix['m2026-10']).toEqual([
      { categoryId: 7, path: 'イベント', postCountPublished: 1 },
    ]);
  });
});

// --- U-21 ---

/** 値が null の場所を、パス（'a.b.0.c'）の一覧で返す。 */
function nullPaths(value: unknown, path = ''): string[] {
  if (value === null) return [path];
  if (typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) =>
    nullPaths(child, path === '' ? key : `${path}.${key}`),
  );
}

/** null を許す場所。伏せ値の列と、page-data.ts のコメントに書いた例外だけ。 */
const NULL_ALLOWED = [
  // 伏せ値
  /^sitePeriod\.[^.]+\.activeUsers$/,
  /^(breakdown|siteBreakdown)\.[^.]+\.(channel|sns|local|newReturning|device)\.[^.]+$/,
  /^breakdown\.[^.]+\.device\.[^.]+\.(pageviews|sessions)$/,
  /^heatmap\.[^.]+\.\d+$/,
  /^period\.[^.]+\.(landingSessions|scrollCount|engagementSeconds)$/,
  // 例外: 比較の相手がない
  /^periods\.\d+\.(prevId|yoyId)$/,
  // 例外: 値がない、まだ比較できない
  /^(posts\.\d+|post)\.(pv7|pv30|band30)$/,
  /^categories\.\d+\.parentId$/,
  /^(benchmark|benchmark30|ownMedian30d)$/,
  /^benchmark\.(p25|p50|p75)\.\d+$/,
  /^cumulative\.\d+$/,
  /^summary\.(ownMedian30d|band30)$/,
  /^topChannelByPeriod\.[^.]+\.\d+$/,
  /^period\.[^.]+\.\d+\.median30$/,
];

describe('U-21: 埋め込み JSON のスキーマ', () => {
  const cache = makeCache();
  const pages: [name: string, data: unknown][] = [
    ['dashboard', buildDashboard(cache, BUILT_AT)],
    ...LIST_KINDS.map(
      (kind) => [`articles/${kind}`, buildArticleList(cache, kind, BUILT_AT)] as [string, unknown],
    ),
    ...listArticleIds(cache).map(
      (id) => [`articles/${id}`, buildArticleDetail(cache, id, BUILT_AT)] as [string, unknown],
    ),
    ['authors', buildAuthorIndex(cache, BUILT_AT)],
    ...listAuthorSlugs(cache).map(
      (slug) => [`authors/${slug}`, buildAuthorPage(cache, slug, BUILT_AT)] as [string, unknown],
    ),
    ['categories', buildCategories(cache, BUILT_AT)],
    ['categories/seasonal', buildSeasonal(cache, BUILT_AT)],
    ['tags', buildTagIndex(cache, BUILT_AT)],
    ...listTagIds(cache).map(
      (id) => [`tags/${id}`, buildTagPage(cache, id, BUILT_AT)] as [string, unknown],
    ),
    ['activity', buildActivity(cache, BUILT_AT)],
  ];

  it.each(pages)('%s: null は、伏せ値の列と型で明示した例外だけ', (_name, data) => {
    expect(data).not.toBeNull();
    const unexpected = nullPaths(data).filter(
      (path) => !NULL_ALLOWED.some((pattern) => pattern.test(path)),
    );
    expect(unexpected).toEqual([]);
  });

  it.each(pages)('%s: JSON にしても同じ値で、undefined を含まない', (_name, data) => {
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
  });

  it('各スキーマは、組み立てた JSON を通す', () => {
    expect(dashboardDataSchema.safeParse(buildDashboard(cache, BUILT_AT)).success).toBe(true);
    for (const kind of LIST_KINDS) {
      const data = buildArticleList(cache, kind, BUILT_AT);
      expect(articleListDataSchema.safeParse(data).success).toBe(true);
    }
    expect(
      articleDetailDataSchema.safeParse(buildArticleDetail(cache, 102, BUILT_AT)).success,
    ).toBe(true);
    expect(authorIndexDataSchema.safeParse(buildAuthorIndex(cache, BUILT_AT)).success).toBe(true);
    expect(authorPageDataSchema.safeParse(buildAuthorPage(cache, SATO, BUILT_AT)).success).toBe(
      true,
    );
    expect(categoryDataSchema.safeParse(buildCategories(cache, BUILT_AT)).success).toBe(true);
    expect(seasonalDataSchema.safeParse(buildSeasonal(cache, BUILT_AT)).success).toBe(true);
    expect(tagIndexDataSchema.safeParse(buildTagIndex(cache, BUILT_AT)).success).toBe(true);
    expect(tagPageDataSchema.safeParse(buildTagPage(cache, 201, BUILT_AT)).success).toBe(true);
    expect(activityDataSchema.safeParse(buildActivity(cache, BUILT_AT)).success).toBe(true);
  });

  it('伏せ値でない項目の null を受け付けない', () => {
    const data = structuredClone(buildDashboard(cache, BUILT_AT));
    const row = data.sitePeriod.last7;
    if (row === undefined) throw new Error('last7 がない');

    row.activeUsers = null;
    expect(dashboardDataSchema.safeParse(data).success).toBe(true);

    const broken = {
      ...data,
      sitePeriod: { ...data.sitePeriod, last7: { ...row, pageviews: null } },
    };
    expect(dashboardDataSchema.safeParse(broken).success).toBe(false);

    const detail = buildArticleDetail(cache, 102, BUILT_AT);
    expect(
      articleDetailDataSchema.safeParse({ ...detail, post: { ...detail?.post, pvTotal: null } })
        .success,
    ).toBe(false);
    expect(articleDetailDataSchema.safeParse({ ...detail, isEvergreen365: null }).success).toBe(
      false,
    );
  });

  it('未知のキーを落とさずに失敗させる', () => {
    const data = buildDashboard(cache, BUILT_AT);
    expect(dashboardDataSchema.safeParse({ ...data, extra: 1 }).success).toBe(false);
    expect(
      dashboardDataSchema.safeParse({ ...data, meta: { ...data.meta, secret: 'x' } }).success,
    ).toBe(false);
    expect(
      dashboardDataSchema.safeParse({ ...data, sitePeriod: { ...data.sitePeriod, last365: {} } })
        .success,
    ).toBe(false);

    const list = buildArticleList(cache, 'search', BUILT_AT);
    const first = list.posts[0];
    expect(
      articleListDataSchema.safeParse({ ...list, posts: [{ ...first, email: 'a@example.com' }] })
        .success,
    ).toBe(false);
  });

  it('定義にない区分、欠けた区分、形の違う期間 ID を受け付けない', () => {
    const data = buildDashboard(cache, BUILT_AT);
    const last7 = data.breakdown.last7;
    if (last7 === undefined) throw new Error('last7 がない');
    const withSns = { ...last7, channel: { ...last7.channel, sns: 1 } };
    expect(
      dashboardDataSchema.safeParse({ ...data, breakdown: { ...data.breakdown, last7: withSns } })
        .success,
    ).toBe(false);

    const withoutSearch = {
      ...last7,
      channel: Object.fromEntries(
        Object.entries(last7.channel).filter(([bucket]) => bucket !== 'search'),
      ),
    };
    expect(
      dashboardDataSchema.safeParse({
        ...data,
        breakdown: { ...data.breakdown, last7: withoutSearch },
      }).success,
    ).toBe(false);

    expect(
      dashboardDataSchema.safeParse({ ...data, posting: { 'm2026-13': { postCount: 1 } } }).success,
    ).toBe(false);
  });
});
