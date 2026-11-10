/**
 * 記事の種類の判定（src/lib/derive/sections.ts。2026-11-10 の依頼者の決定）。
 */
import { describe, expect, it } from 'vitest';

import { AD_CATEGORY_ID, ARTICLE_CATEGORY_ID, EVENT_CATEGORY_ID } from '@/lib/config';
import {
  benchmarkScopeOf,
  primarySection,
  SECTION_LIST_PATH,
  sectionOfCategory,
  sectionsOfPost,
} from '@/lib/derive';
import { parseQuery } from '@/lib/query';

describe('sectionOfCategory', () => {
  it('親そのもの、または直下の子なら、その種類', () => {
    expect(sectionOfCategory(ARTICLE_CATEGORY_ID, null)).toBe('article');
    expect(sectionOfCategory(31, ARTICLE_CATEGORY_ID)).toBe('article');
    expect(sectionOfCategory(EVENT_CATEGORY_ID, null)).toBe('event');
    expect(sectionOfCategory(41, EVENT_CATEGORY_ID)).toBe('event');
  });

  it('マップや広告の親と子は、どちらでもない', () => {
    expect(sectionOfCategory(AD_CATEGORY_ID, null)).toBeNull();
    expect(sectionOfCategory(6, AD_CATEGORY_ID)).toBeNull();
    expect(sectionOfCategory(24, null)).toBeNull();
  });
});

describe('sectionsOfPost と primarySection', () => {
  const link = (categoryId: number, parentId: number | null) => ({ categoryId, parentId });

  it('両方に属する記事は両方（記事が先）。主な種類は記事', () => {
    const sections = sectionsOfPost([link(41, EVENT_CATEGORY_ID), link(31, ARTICLE_CATEGORY_ID)]);
    expect(sections).toEqual(['article', 'event']);
    expect(primarySection(sections)).toBe('article');
  });

  it('親に直接付いた記事も、その種類', () => {
    expect(sectionsOfPost([link(EVENT_CATEGORY_ID, null)])).toEqual(['event']);
  });

  it('記事+広告は記事。どちらにも属さなければ空で、主な種類は null', () => {
    expect(sectionsOfPost([link(6, AD_CATEGORY_ID), link(ARTICLE_CATEGORY_ID, null)])).toEqual([
      'article',
    ]);
    expect(sectionsOfPost([link(6, AD_CATEGORY_ID)])).toEqual([]);
    expect(primarySection([])).toBeNull();
    expect(primarySection(['event'])).toBe('event');
  });

  it('分布の scope と一覧の入口のパス', () => {
    expect(benchmarkScopeOf(null)).toBe('all');
    expect(benchmarkScopeOf('article')).toBe('kind:article');
    expect(benchmarkScopeOf('event')).toBe('kind:event');
    expect(SECTION_LIST_PATH).toEqual({ article: '/articles', event: '/events' });
  });
});

describe('URL のクエリ（S-10a〜S-10e は S-02a〜S-02e と同じパラメータ）', () => {
  const periodIds = ['last7', 'last28'];
  it('S-10e は cat、author、ym、q、sort を使い、cat はそのタブの許可リストだけ', () => {
    const allow = {
      screen: 's10e' as const,
      periodIds,
      categories: [{ id: EVENT_CATEGORY_ID, parentId: null }],
      authorSlugs: ['sato-hanako'],
      publishedMonths: ['2026-10'],
    };
    expect(parseQuery(`cat=${EVENT_CATEGORY_ID}&q=祭り`, allow)).toMatchObject({
      cat: EVENT_CATEGORY_ID,
      q: '祭り',
    });
    expect(parseQuery(`cat=${ARTICLE_CATEGORY_ID}`, allow).cat).toBeNull();
    expect(parseQuery('author=sato-hanako&sort=pv', allow)).toMatchObject({
      author: 'sato-hanako',
      sort: 'pv',
    });
  });

  it('S-10a と S-10c は n を使い、S-10b と S-10d は使わない', () => {
    expect(parseQuery('n=50', { screen: 's10a', periodIds }).n).toBe(50);
    expect(parseQuery('n=50', { screen: 's10c', periodIds }).n).toBe(50);
    expect(parseQuery('n=50', { screen: 's10b', periodIds }).n).toBe(20);
    expect(parseQuery('n=50&cat=9', { screen: 's10d', periodIds })).toMatchObject({
      n: 20,
      cat: null,
    });
  });
});
