/**
 * 流入チャネルの最多の区分（04 §5 の topChannel）。
 */
import { CHANNEL_BUCKETS } from '@/lib/config';
import type { Channel, Masked } from '@/lib/page-data';

/**
 * 最多の区分を返す。同じ値のときは CHANNEL_BUCKETS の順で先のもの。
 *
 * null を返すとき:
 * - 全区分が伏せ値（null）。
 * - 見えている値の最大が 0。訪問がないか、最多が伏せ値の側にあるので、区分を名指ししない。
 */
export function topChannel(record: Record<Channel, Masked>): Channel | null {
  let top: Channel | null = null;
  let max = 0;
  for (const bucket of CHANNEL_BUCKETS) {
    const value = record[bucket];
    if (value !== null && value > max) {
      top = bucket;
      max = value;
    }
  }
  return top;
}
