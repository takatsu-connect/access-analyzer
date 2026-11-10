/**
 * 表示用の計算（04 §5）。どれも純粋な関数で、バッチの集計とは別。
 */
export { topChannel } from './channel';
export type { TopChannel } from './channel';
export {
  addDays,
  diffDays,
  latestConfirmedDay,
  monthStart,
  splitYmd,
  todayJst,
  unconfirmedFrom,
} from './dates';
export type { YmdParts } from './dates';
export {
  fold6,
  HEATMAP_DAY_ORDER,
  HEATMAP_DAYS,
  HEATMAP_HOURS,
  HEATMAP_SLOTS,
  heatmapView,
  orderDays,
  weekdayCounts,
} from './heatmap';
export type { HeatmapMargins, HeatmapMeans, HeatmapView } from './heatmap';
export { isDisplayableDomain, safeExternalUrl, SMALLPIECE_URL } from './links';
export { compare, share, shareOf, tenOf } from './numbers';
export type { Comparison } from './numbers';
export { monthProgress, partialMonthStartDay } from './periods';
export type { MonthProgress } from './periods';
export {
  ARTICLE_SECTIONS,
  BENCHMARK_SCOPES,
  benchmarkScopeOf,
  primarySection,
  SECTION_LIST_PATH,
  SECTION_ROOT_ID,
  sectionOfCategory,
  sectionsOfPost,
} from './sections';
export type { ArticleSection } from './sections';
export { isDelayed } from './status';
