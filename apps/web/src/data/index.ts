/**
 * ページから呼ぶ入口。公開ビューの読み出し（loadAll）と、埋め込み JSON の組み立てをつなぐ。
 *
 * ビルド時にだけ実行される（generateStaticParams とページの Server Component から呼ぶ）。
 * 戻り値は zod で検証済み。存在しない記事、著者、タグは null（ページ側で notFound にする）。
 */
import type {
  ActivityData,
  ArticleDetailData,
  ArticleListData,
  ArticleListKind,
  ArticleSection,
  AuthorIndexData,
  AuthorPageData,
  CategoryData,
  DashboardData,
  PageMeta,
  SeasonalData,
  TagIndexData,
  TagPageData,
} from '@/lib/page-data';

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
  listEventArticleIds,
  listAuthorSlugs,
  listTagIds,
} from './pages';
import { loadAll } from './pub';

/** ビルドの時刻。プロセスの中で 1 つに固定する（meta.builtAt）。 */
const BUILT_AT = new Date();

/**
 * 全ページ共通の meta だけを返す（各ページの埋め込み JSON の meta と同じ値）。
 * レイアウト（src/app/layout.tsx）が DataStatus と CommonNotes に渡す。
 */
export async function getPageMeta(): Promise<PageMeta> {
  return buildCommon(await loadAll(), BUILT_AT).meta;
}

export async function getDashboardData(): Promise<DashboardData> {
  return buildDashboard(await loadAll(), BUILT_AT);
}

/** 記事一覧。section は「記事」タブ（article）か「イベント記事」タブ（event）。 */
export async function getArticleListData(
  kind: ArticleListKind,
  section: ArticleSection = 'article',
): Promise<ArticleListData> {
  return buildArticleList(await loadAll(), kind, BUILT_AT, undefined, section);
}

export async function getArticleDetailData(postId: number): Promise<ArticleDetailData | null> {
  return buildArticleDetail(await loadAll(), postId, BUILT_AT);
}

export async function getArticleIds(): Promise<number[]> {
  return listArticleIds(await loadAll());
}

/**
 * 主な種類がイベントの記事の ID。レイアウトがヘッダに渡し、記事詳細の現在地を決める
 * （静的な HTML とブラウザで同じ結果になるよう、DOM ではなくビルド時のデータで決める）。
 */
export async function getEventArticleIds(): Promise<number[]> {
  return listEventArticleIds(await loadAll());
}

export async function getAuthorIndexData(): Promise<AuthorIndexData> {
  return buildAuthorIndex(await loadAll(), BUILT_AT);
}

export async function getAuthorPageData(slug: string): Promise<AuthorPageData | null> {
  return buildAuthorPage(await loadAll(), slug, BUILT_AT);
}

export async function getAuthorSlugs(): Promise<string[]> {
  return listAuthorSlugs(await loadAll());
}

export async function getCategoryData(): Promise<CategoryData> {
  return buildCategories(await loadAll(), BUILT_AT);
}

export async function getSeasonalData(): Promise<SeasonalData> {
  return buildSeasonal(await loadAll(), BUILT_AT);
}

export async function getTagIndexData(): Promise<TagIndexData> {
  return buildTagIndex(await loadAll(), BUILT_AT);
}

export async function getTagPageData(tagId: number): Promise<TagPageData | null> {
  return buildTagPage(await loadAll(), tagId, BUILT_AT);
}

export async function getTagIds(): Promise<number[]> {
  return listTagIds(await loadAll());
}

export async function getActivityData(): Promise<ActivityData> {
  return buildActivity(await loadAll(), BUILT_AT);
}
