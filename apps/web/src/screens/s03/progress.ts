/**
 * S-03 の表示用の小さな計算（05 §5、04 §3.4）。どれも純粋な関数。
 */
import type { ArticleDetailData, BenchmarkPoint } from '@/lib/page-data';

/** 帯の文と「これまでの記事と比べて」で、30 日の値を使い始める日数。 */
export const FULL_DAYS = 30;

/** 帯と比べ始める日数（3 日未満は「まだ比較できません」）。 */
export const MIN_COMPARE_DAYS = 3;

/** 累積曲線の横軸の長さ。公開 30 日以内の記事は 30、それ以降は 90。 */
export function curveDays(ageDays: number): 30 | 90 {
  return ageDays <= FULL_DAYS ? 30 : 90;
}

/**
 * 帯の n 日目の 3 つの値。帯そのものがないか、その n が欠けていれば null
 * （母集団が足りない。伏せ値ではない）。
 */
export function benchmarkAt(
  benchmark: ArticleDetailData['benchmark'],
  n: number,
): BenchmarkPoint | null {
  if (benchmark === null || !Number.isInteger(n) || n < 1) return null;
  const p25 = benchmark.p25[n - 1] ?? null;
  const p50 = benchmark.p50[n - 1] ?? null;
  const p75 = benchmark.p75[n - 1] ?? null;
  if (p25 === null || p50 === null || p75 === null) return null;
  return { p25, p50, p75 };
}

/**
 * 公開 30 日未満の記事の「n 日目で pv 回」。n は post.ageDays（04 §3.4）。
 * 公開した当日（ageDays = 0）は 1 日目として扱う。その日の累積がなければ null。
 */
export function youngProgress(
  ageDays: number,
  cumulative: ArticleDetailData['cumulative'],
): { n: number; pv: number } | null {
  const n = Math.max(ageDays, 1);
  const pv = cumulative[n - 1] ?? null;
  return pv === null ? null : { n, pv };
}
