/**
 * データの更新が遅れているかどうか（05 §2.7 の DataStatus、U-25）。
 */
import { STALE_AFTER_DAYS } from '@/lib/config';
import type { PageMeta } from '@/lib/page-data';

import { diffDays } from './dates';

/**
 * 「更新が遅れています」を出すかどうか。
 * バッチが遅れの印を付けた（isStale）か、今日 − 基準日 が 3 日以上のとき。
 *
 * @param today JST の今日（'YYYY-MM-DD'）。todayJst(new Date()) の値を渡す。
 */
export function isDelayed(meta: Pick<PageMeta, 'isStale' | 'baseDate'>, today: string): boolean {
  return meta.isStale || diffDays(today, meta.baseDate) >= STALE_AFTER_DAYS;
}
