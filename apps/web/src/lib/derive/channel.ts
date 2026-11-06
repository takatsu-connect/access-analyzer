/**
 * 流入チャネルの最多の区分（04 §5 の topChannel）。
 */
import { CHANNEL_BUCKETS } from '@/lib/config';
import type { Channel, Masked } from '@/lib/page-data';

/**
 * 最多の区分。null は伏せ値、'none' は訪問がない（伏せ値ではない。「該当なし」と書く）。
 */
export type TopChannel = Channel | null | 'none';

/**
 * 最多の区分を返す。同じ値のときは CHANNEL_BUCKETS の順で先のもの。
 *
 * - 全区分が 0（訪問がない）: 'none'。隠しているものがないので、伏せ値とは書かない。
 * - 全区分が伏せ値（null）: null。
 * - 見えている値がすべて 0 で、伏せ値もある: null。訪問はあり、最多が伏せ値の側にあるので、区分を名指ししない。
 *
 * 記事にその期間の行がないとき（訪問がない）は、呼び出し側が 'none' にする。
 */
export function topChannel(record: Record<Channel, Masked>): TopChannel {
  let top: Channel | null = null;
  let max = 0;
  let hasMasked = false;
  for (const bucket of CHANNEL_BUCKETS) {
    const value = record[bucket];
    if (value === null) {
      hasMasked = true;
    } else if (value > max) {
      top = bucket;
      max = value;
    }
  }
  if (top !== null) return top;
  return hasMasked ? null : 'none';
}
