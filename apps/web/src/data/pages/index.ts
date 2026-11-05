/**
 * 組み立て層（docs/design/04_api.md §5）。PubCache から各ページの埋め込み JSON を作り、zod で検証して返す。
 */
export { buildActivity } from './activity';
export { buildArticleDetail, buildArticleList, listArticleIds } from './articles';
export { buildAuthorIndex, buildAuthorPage, listAuthorSlugs } from './authors';
export { buildDashboard } from './dashboard';
export { buildCommon } from './shared';
export {
  buildCategories,
  buildSeasonal,
  buildTagIndex,
  buildTagPage,
  listTagIds,
} from './taxonomy';
