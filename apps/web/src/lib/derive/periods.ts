/**
 * 月の期間の状態（03 §3）。
 *
 * バッチは、月末から 7 日たつまで月の数字を取り直す（`is_confirmed` が false）。
 * その間を「月の途中」と「月は終わったが、まだ数字が増えうる」に分ける。
 * 終わった月に「途中まで」と書くと、公開本数のように月末で固まる数字まで途中に見えるため。
 */
import type { Period } from '@/lib/page-data';

import { addDays, splitYmd } from './dates';

/** confirmed: 確定。settling: 月は終わったが、まだ数字が増えうる。inProgress: 月の途中。 */
export type MonthProgress = 'confirmed' | 'settling' | 'inProgress';

/**
 * 月の状態を返す。基準日の属する月は end が基準日なので、end が月末でなければ月の途中。
 * 基準日が月末の日は、その月の日がそろっているので settling にする。
 */
export function monthProgress(period: Pick<Period, 'end' | 'isConfirmed'>): MonthProgress {
  if (period.isConfirmed) return 'confirmed';
  return splitYmd(addDays(period.end, 1)).day === 1 ? 'settling' : 'inProgress';
}
