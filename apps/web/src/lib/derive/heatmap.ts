/**
 * ヒートマップをスマホの 6 区分に畳む（05 §2.6、U-17）。
 */
import type { Masked } from '@/lib/page-data';

export const HEATMAP_DAYS = 7;
export const HEATMAP_HOURS = 24;
export const HEATMAP_SLOTS = 6;
const HOURS_PER_SLOT = HEATMAP_HOURS / HEATMAP_SLOTS;

/**
 * 画面に並べる曜日の順（月曜始まり。土日を隣り合わせで見るため。2026-11-10 の依頼者の決定）。
 * 値は曜日の番号（0 = 日曜。GA4 の dayOfWeek と同じ）。
 */
export const HEATMAP_DAY_ORDER: readonly number[] = [1, 2, 3, 4, 5, 6, 0];

/** 曜日の番号の順（0 = 日曜）に並んだ行を、HEATMAP_DAY_ORDER の順に並べ替える。 */
export function orderDays<T>(rowsBySunday: readonly T[]): T[] {
  if (rowsBySunday.length !== HEATMAP_DAYS) {
    throw new RangeError('曜日の行は 7 つで渡します。');
  }
  return HEATMAP_DAY_ORDER.map((dow) => rowsBySunday[dow] as T);
}

/**
 * 期間（両端を含む 'YYYY-MM-DD'）に各曜日が何日あるか。添字 0 = 日曜。
 * 暦日の曜日なので、UTC で数えてもタイムゾーンに左右されない。
 */
export function weekdayCounts(start: string, end: string): number[] {
  const counts = new Array<number>(HEATMAP_DAYS).fill(0);
  const first = Date.parse(`${start}T00:00:00Z`);
  const last = Date.parse(`${end}T00:00:00Z`);
  if (Number.isNaN(first) || Number.isNaN(last)) throw new RangeError('日付の形が違います。');
  const days = Math.round((last - first) / 86_400_000) + 1;
  const firstDow = new Date(first).getUTCDay();
  for (let offset = 0; offset < days; offset += 1) {
    const dow = (firstDow + offset) % HEATMAP_DAYS;
    counts[dow] = (counts[dow] ?? 0) + 1;
  }
  return counts;
}

/** 曜日ごと・時間帯ごとの合計（バッチが伏せる前の値から作り、伏せたもの。ADR 0003 判断 8）。 */
export type HeatmapMargins = { dow: readonly Masked[]; hour: readonly Masked[] };

/** 行（曜日。添字 0 = 日曜）ごとと列ごとの平均。 */
export type HeatmapMeans = { rows: Masked[]; cols: Masked[] };

export type HeatmapView = {
  /** 7 × 24（行の添字 0 = 日曜）。 */
  hourly: Masked[][];
  /** 7 × 6（行の添字 0 = 日曜）。 */
  slots: Masked[][];
  /** 平均の列と行。合計がない期間（バッチがまだ作っていない）は undefined。 */
  hourlyMeans: HeatmapMeans | undefined;
  slotMeans: HeatmapMeans | undefined;
};

const divide = (value: Masked, by: number): Masked =>
  value === null ? null : by > 0 ? value / by : 0;

/**
 * S-01 のヒートマップに出す値（05 §3。2026-11-10 の依頼者の決定）。
 *
 * - 'avg'（1 日あたりの平均）: マスは「その曜日・時間帯の回数 ÷ 期間にその曜日があった日数」。
 *   'sum'（期間の合計）: マスは回数そのまま。
 * - 平均の列（曜日ごと）と行（時間帯ごと）は、マスの値からではなく、伏せる前の値から作った
 *   合計（margins）を、並んだマスの数で割る。マスに伏せ値があっても出せる。合計そのものが
 *   伏せ値なら null。
 *   - 曜日: 合計 ÷ 列の数（広い画面 24、狭い画面 6）。'avg' はさらに、その曜日の日数で割る。
 *   - 時間帯: 合計 ÷ 7。'avg' は合計 ÷ 期間の日数（どの曜日も 1 日として数える）。
 *     狭い画面の区分は 4 時間の合計（どれかが伏せ値なら null）から同じように割る。
 */
export function heatmapView(input: {
  cells: readonly Masked[];
  margins: HeatmapMargins | undefined;
  start: string;
  end: string;
  mode: 'avg' | 'sum';
}): HeatmapView {
  const { cells, margins, mode } = input;
  if (cells.length !== HEATMAP_DAYS * HEATMAP_HOURS) {
    throw new RangeError('ヒートマップは 168 要素で渡します。');
  }
  const weekdays = weekdayCounts(input.start, input.end);
  const totalDays = weekdays.reduce((sum, count) => sum + count, 0);
  const isAverage = mode === 'avg';
  const scaled = cells.map((cell, index) =>
    isAverage ? divide(cell, weekdays[Math.floor(index / HEATMAP_HOURS)] ?? 0) : cell,
  );
  const hourly = [...new Array<undefined>(HEATMAP_DAYS).keys()].map((dow) =>
    scaled.slice(dow * HEATMAP_HOURS, (dow + 1) * HEATMAP_HOURS),
  );
  const slots = fold6(scaled);
  if (margins === undefined) return { hourly, slots, hourlyMeans: undefined, slotMeans: undefined };

  const rowMeans = (perRow: number): Masked[] =>
    margins.dow.map((total, dow) => divide(total, perRow * (isAverage ? (weekdays[dow] ?? 0) : 1)));
  const colDivisor = isAverage ? totalDays : HEATMAP_DAYS;
  const slotTotals = [...new Array<undefined>(HEATMAP_SLOTS).keys()].map((slot) => {
    let sum: Masked = 0;
    for (const value of margins.hour.slice(slot * HOURS_PER_SLOT, (slot + 1) * HOURS_PER_SLOT)) {
      sum = sum === null || value === null ? null : sum + value;
    }
    return sum;
  });
  return {
    hourly,
    slots,
    hourlyMeans: {
      rows: rowMeans(HEATMAP_HOURS),
      cols: margins.hour.map((total) => divide(total, colDivisor)),
    },
    slotMeans: {
      rows: rowMeans(HEATMAP_SLOTS),
      cols: slotTotals.map((total) => divide(total, colDivisor)),
    },
  };
}

/**
 * 168 要素（index = 曜日 * 24 + 時。曜日 0 = 日曜）を 7 × 6 に畳む。
 *
 * - 区分は 0〜3 時、4〜7 時、…、20〜23 時。値は区分の中の合計
 *   （1 日あたり平均のヒートマップなら、平均の合計）。
 * - 区分の中に伏せ値（null）が 1 つでもあれば、その区分は null。
 *   見えている値だけを足すと、実際より小さい数を出してしまうため。
 */
export function fold6(heatmap168: readonly Masked[]): Masked[][] {
  if (heatmap168.length !== HEATMAP_DAYS * HEATMAP_HOURS) {
    throw new RangeError('ヒートマップは 168 要素で渡します。');
  }
  const folded: Masked[][] = [];
  for (let dow = 0; dow < HEATMAP_DAYS; dow += 1) {
    const row: Masked[] = [];
    for (let slot = 0; slot < HEATMAP_SLOTS; slot += 1) {
      const start = dow * HEATMAP_HOURS + slot * HOURS_PER_SLOT;
      let sum: Masked = 0;
      for (const cell of heatmap168.slice(start, start + HOURS_PER_SLOT)) {
        sum = sum === null || cell === null ? null : sum + cell;
      }
      row.push(sum);
    }
    folded.push(row);
  }
  return folded;
}
