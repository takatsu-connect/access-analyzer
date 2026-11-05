/**
 * グラフ部品が共有する座標の計算（ADR 0008）。
 *
 * 横の位置は SVG の幅に対する百分率、縦の位置は px で持つ。こうすると、横幅いっぱいに広げても
 * 高さと文字の大きさが変わらない（05 §2.6「横幅いっぱい、高さ 160px」）。window は読まない。
 */
import { scaleLinear } from 'd3-scale';

/** 左右の余白（%）。端の日付ラベルが切れないようにする。 */
const X_PAD_PERCENT = 5;

/** 小数第 2 位で丸める。サーバーとブラウザで同じ文字列になり、HTML も小さくなる。 */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 横の位置（0〜100）。点が 1 つなら中央。 */
export function xPercent(index: number, count: number): number {
  if (count <= 1) return 50;
  return round2(X_PAD_PERCENT + (index * (100 - 2 * X_PAD_PERCENT)) / (count - 1));
}

/** SVG の属性に書く百分率（'42.5%'）。 */
export function percent(value: number): string {
  return `${round2(value)}%`;
}

export type ZeroBasedAxis = {
  /** 値 → 縦の位置（px）。 */
  y: (value: number) => number;
  /** 目盛りの値（0 を含む整数）。 */
  ticks: number[];
};

/** 0 始まりの縦軸（05 §2.8）。最大値が 0 でも落ちない。 */
export function zeroBasedAxis(maxValue: number, top: number, bottom: number): ZeroBasedAxis {
  const scale = scaleLinear()
    .domain([0, Math.max(1, maxValue)])
    .range([bottom, top])
    .nice(4);
  return {
    y: (value) => round2(scale(value)),
    ticks: scale.ticks(4).filter((tick) => Number.isInteger(tick)),
  };
}
