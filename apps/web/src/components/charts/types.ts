/**
 * グラフ部品の props の型（05 §2.8、ADR 0008）。
 *
 * - 部品は表を描かない。同じ値の表は、呼び出し側が並べる（NFR-99）。
 * - 図ごとに変わる文言は props で受ける。呼び出し側が、辞書（src/lib/ui-text.ts）のキーから作る
 *   （使うキーは、各 props のコメントに書いた）。
 * - 関数の props を持つ LineChart と Heatmap は Client Component なので、
 *   Server Component から直接は関数を渡せない。画面の Client Component から使う。
 */
import type { Band, Masked } from '@/lib/page-data';

import type { HeatScale } from './heat-levels';

// --- LineChart（日別推移。S-01、S-03） ---

/** 固定行に出す 1 点（日別なら 1 日、週別なら 1 週）。 */
export type LineChartPoint = {
  /** 日別ならその日。週別なら週の最初の日。'YYYY-MM-DD'。 */
  start: string;
  /** 日別なら start と同じ。週別なら週の最後の日。 */
  end: string;
  /** 当期間の値（週別は週の合計）。 */
  value: number;
  /** 前期間の値。前期間を渡していないか、その日の値が欠けていれば null。 */
  prev: number | null;
  /** 公開した記事の本数（週別は週の合計）。渡していなければ 0。 */
  published: number;
  /** あとで増えることがある日（週別は、そういう日を 1 日でも含む週）。 */
  unconfirmed: boolean;
};

export type LineChartProps = {
  /** 図の説明。<title> と、キーボード操作の領域の名前に使う（例: 「日ごとの読まれた回数」）。 */
  title: string;
  /** 固定行に出す指標の名称（例: 「読まれた回数」）。 */
  valueLabel: string;
  /** 'YYYY-MM-DD' の昇順。1 日 1 要素。 */
  dates: readonly string[];
  /** 当期間の値。dates と同じ長さ。 */
  values: readonly number[];
  /**
   * 前期間の値（dates と同じ長さに揃えたもの。値がない日は null）。
   * 渡さなければ前期間の線も凡例も出さない（S-03）。
   */
  prevValues?: readonly (number | null)[];
  /** あとで増えることがある最初の日（unconfirmedFrom(baseDate)）。この日以降を薄く描く。 */
  unconfirmedFrom?: string;
  /**
   * 固定行の既定の日（最新の確定日。latestConfirmedDay(baseDate)）。
   * 渡さないか期間の外なら、薄くない最後の点（なければ最後の点）。
   */
  defaultDate?: string;
  /** 日ごとの公開本数（dates と同じ長さ）。1 以上の日の下端に点を描く（S-01 だけ）。 */
  publishedCounts?: readonly number[];
  /** 7 日ごとに畳む（90 日のときの既定。日別との切り替えは呼び出し側）。 */
  weekly?: boolean;
  /**
   * 固定行の文を差し替える。渡さなければ辞書の chart.fixedRow / chart.fixedRow.single を使う。
   * 週別のときは、辞書の chart.fixedRow.week / chart.fixedRow.week.single から作って渡す。
   */
  fixedRowText?: (point: LineChartPoint) => string;
  /**
   * 公開本数の添え書き（例: 「。この日に 2 本公開」）。本数が 1 以上の点で、固定行の文の後ろに足す。
   * 辞書の chart.fixedRow.published から作る。fixedRowText を渡したときは使わない。
   */
  publishedText?: (count: number) => string;
};

// --- Curve（累積曲線と四分位の帯。S-03） ---

export type CurveBenchmark = {
  p25: readonly (number | null)[];
  p50: readonly (number | null)[];
  p75: readonly (number | null)[];
};

export type CurveProps = {
  /** 図の説明（<title>）。 */
  title: string;
  /** この記事の累積。添字 0 = 1 日目。null はまだたっていない日。 */
  cumulative: readonly (number | null)[];
  /** 帯。null か省略なら、記事の線だけを描く。欠けた n（null）は面と点線を切る。 */
  benchmark?: CurveBenchmark | null;
  /** 横軸の長さ（公開 30 日以内の記事は 30、それ以降は 90）。 */
  days: 30 | 90;
  /** 凡例の文言。 */
  labels: {
    /** この記事（実線）。辞書の legend.curve.post。 */
    post: string;
    /** 多くの記事はこの範囲（面）。辞書の metric.M19.label。 */
    band: string;
    /** 真ん中の記事（点線）。辞書の metric.M27.label。 */
    median: string;
  };
  /** 横軸の目盛りの文言（例: 30 → 「30 日目」）。辞書の absent.dayN から作る。 */
  dayLabel: (day: number) => string;
};

// --- HBar（構成比の横棒）と MiniBar（表の行に埋める棒） ---

export type HBarItem = {
  key: string;
  /** 区分の表示名。 */
  label: string;
  /** null は伏せ値（棒を描かない）。0 は 0 として描く。 */
  value: Masked;
};

export type HBarCompare = {
  /** 比較相手の構成比（0〜1。items と同じ順。出せない区分は null）。 */
  shares: readonly (number | null)[];
  /**
   * 凡例の文言。前の期間は辞書の legend.compare.prev（「縦の線: 前の期間」）、
   * サイト全体は s05.referrer.legend（「縦の線: サイト全体」）。
   */
  legend: string;
  /**
   * 区分ごとの添え書き（例: 「61%」→「前: 61%」。辞書の hbar.compare.prev から作る）。
   * 省略すると数字は添えない。
   */
  text?: (share: string) => string;
};

export type HBarProps = {
  /** 図の説明（<title>）。 */
  title: string;
  items: readonly HBarItem[];
  /** 構成比の分母（その指標の合計の列）。20 未満か伏せ値なら、比率も棒も出さない。 */
  total: Masked;
  /** 「1,218（42%）」の形を作る。辞書の hbar.valueWithShare から作る。 */
  valueWithShare: (count: string, share: string) => string;
  /** 比較相手（前の期間、またはサイト全体）。 */
  compare?: HBarCompare;
};

export type MiniBarProps = {
  /** 図の説明（<title>。例: 「グルメ: 読まれた回数 320」）。 */
  title: string;
  /** null は伏せ値（何も描かない）。 */
  value: Masked;
  /** 棒の長さの基準（同じ列の最大値）。 */
  max: number;
};

// --- BandDot（帯と点。S-02b、S-03、S-05） ---

export type BandDotProps = {
  /** 3 値か null だけ。数値を渡す口はない（05 §2.4）。 */
  band: Band | null;
  /** 'figure'（既定）は帯と点と文言。'text' は文言だけ（スマホの表のセル用）。 */
  variant?: 'figure' | 'text';
};

// --- Heatmap（格子。S-01 の曜日 × 時間帯、S-06b の月 × カテゴリ） ---

export type HeatmapCell = {
  /**
   * 'cell' は格子のマス。'rowMean' は右端の列（その行の平均。col = 列の数）、
   * 'colMean' は下端の行（その列の平均。row = 行の数）。
   */
  kind: 'cell' | 'rowMean' | 'colMean';
  row: number;
  col: number;
  /** 'colMean' のときは colMeans.label。 */
  rowLabel: string;
  /** 'rowMean' のときは rowMeans.label。 */
  colLabel: string;
  /** null は伏せ値（平均では、伏せ値のマスを含む行・列）。 */
  value: Masked;
};

/** 格子の外側に足す平均の列または行（heatmapMeans の結果）。 */
export type HeatmapMeans = {
  /** 見出し（列なら上端、行なら左端に出す。例: 「平均」）。 */
  label: string;
  /** 行（または列）ごとの平均。null は出せないもの。 */
  values: readonly Masked[];
};

export type HeatmapProps = {
  /** 図の説明。<title> と、キーボード操作の領域の名前に使う。 */
  title: string;
  rowLabels: readonly string[];
  colLabels: readonly string[];
  /** values[行][列]。null は伏せ値。 */
  values: readonly (readonly Masked[])[];
  /**
   * 固定行の文（選んだセル）。伏せ値のセルの文も、この関数が作る。
   * 辞書の heatmap.fixedRow / heatmap.fixedRow.masked から作る。
   */
  cellText: (cell: HeatmapCell) => string;
  /** 固定行の上の案内（例: 「マスをタップすると、その時間の数字に変わります」。辞書の heatmap.tap.hint）。 */
  hint: string;
  /** 濃淡の凡例の文言（例: legend.heatmap）。 */
  legend: string;
  /** 最初に選んでおくセル。既定は、値がいちばん大きいセル（なければ左上）。 */
  defaultCell?: { row: number; col: number };
  /** セルの中の数字の書式。既定は formatNumber（整数）。平均のときは小数の書式を渡せる。 */
  formatValue?: (value: number) => string;
  /** 列の見出しを何列おきに出すか（24 列なら 3 など）。既定は 1（すべて）。 */
  colLabelEvery?: number;
  /**
   * 濃淡の分位を取る範囲。既定は 'all'（表全体で 1 つ。S-01）。
   * S-06b は、カテゴリごとに季節の波が色に出るよう、カテゴリの並ぶ向き（'row' か 'col'）を渡す（助言 A-2）。
   */
  scale?: HeatScale;
  /** 右端に足す、行ごとの平均の列（S-01）。濃淡は付けず、数字は狭い画面でも出す。 */
  rowMeans?: HeatmapMeans;
  /** 下端に足す、列ごとの平均の行（S-01）。濃淡は付けず、数字は狭い画面でも出す。 */
  colMeans?: HeatmapMeans;
  /** 平均のマスの数字の書式。既定は formatValue（合計のマスでも、平均は小数になりうる）。 */
  formatMean?: (value: number) => string;
};
