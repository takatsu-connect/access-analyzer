/**
 * 記事の種類（「記事」と「イベント」）の判定（2026-11-10 の依頼者の決定）。
 *
 * サイトは WordPress のカテゴリで「記事」（親カテゴリ ARTICLE_CATEGORY_ID）と「イベント」
 * （親カテゴリ EVENT_CATEGORY_ID）を分けている。カテゴリは二階層なので、カテゴリ自身か
 * その親の ID で決まる。判定はこのファイルだけで行う（データの組み立てと画面で同じ関数を使う）。
 */
import { ARTICLE_CATEGORY_ID, EVENT_CATEGORY_ID } from '@/lib/config';
import type { ArticleSection } from '@/lib/page-data';

export type { ArticleSection };

/** 種類の並び（記事が先）。 */
export const ARTICLE_SECTIONS = ['article', 'event'] as const satisfies readonly ArticleSection[];

/** 種類ごとの一覧の入口のパス（S-02e と S-10e）。値はコードに固定し、データから組み立てない。 */
export const SECTION_LIST_PATH: Readonly<Record<ArticleSection, '/articles' | '/events'>> = {
  article: '/articles',
  event: '/events',
};

/** 種類ごとの親カテゴリの ID。 */
export const SECTION_ROOT_ID: Readonly<Record<ArticleSection, number>> = {
  article: ARTICLE_CATEGORY_ID,
  event: EVENT_CATEGORY_ID,
};

/**
 * カテゴリ 1 つの種類。親カテゴリそのものか、その直下の子なら、その種類。
 * どちらでもない（マップ、広告など）なら null。
 */
export function sectionOfCategory(
  categoryId: number,
  parentId: number | null,
): ArticleSection | null {
  for (const section of ARTICLE_SECTIONS) {
    const rootId = SECTION_ROOT_ID[section];
    if (categoryId === rootId || parentId === rootId) return section;
  }
  return null;
}

/**
 * 記事の種類（複数ありうる）。記事に付いたカテゴリの種類の和集合を、ARTICLE_SECTIONS の順で返す。
 * 両方に属する記事は両方（依頼者の決定）。どちらにも属さなければ空。
 */
export function sectionsOfPost(
  categories: readonly { categoryId: number; parentId: number | null }[],
): ArticleSection[] {
  const found = new Set(
    categories.flatMap((category) => {
      const section = sectionOfCategory(category.categoryId, category.parentId);
      return section === null ? [] : [section];
    }),
  );
  return ARTICLE_SECTIONS.filter((section) => found.has(section));
}

/**
 * 記事の主な種類（比べる相手の分布を選ぶのに使う）。記事に属せば article、そうでなくイベントに
 * 属せば event、どちらでもなければ null（全体の分布と比べる）。DB 側の band の計算と同じ規則。
 */
export function primarySection(sections: readonly ArticleSection[]): ArticleSection | null {
  return ARTICLE_SECTIONS.find((section) => sections.includes(section)) ?? null;
}

/** 分布の表（pub_benchmark_curve）の scope の値。null は全体（'all'）。 */
export function benchmarkScopeOf(
  section: ArticleSection | null,
): 'all' | 'kind:article' | 'kind:event' {
  return section === null ? 'all' : `kind:${section}`;
}

/** BI が読む分布の scope（04 §2）。 */
export const BENCHMARK_SCOPES = ['all', 'kind:article', 'kind:event'] as const;
