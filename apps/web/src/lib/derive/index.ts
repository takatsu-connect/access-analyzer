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
export { fold6, HEATMAP_DAYS, HEATMAP_HOURS, HEATMAP_SLOTS } from './heatmap';
export { safeExternalUrl } from './links';
export { compare, share, shareOf, tenOf } from './numbers';
export type { Comparison } from './numbers';
export { monthProgress, partialMonthStartDay } from './periods';
export type { MonthProgress } from './periods';
export { isDelayed } from './status';
