/**
 * グラフ部品の props の型（05 §2.8、ADR 0008）。
 *
 * - 部品は表を描かない。同じ値の表は、呼び出し側が並べる（NFR-99）。
 * - 辞書（src/lib/ui-text.ts）にキーがない文言は、props で受ける。
 * - 関数の props を持つ LineChart と Heatmap は Client Component なので、
 *   Server Component から直接は関数を渡せない。画面の Client Component から使う。
 */
import type { Band, Masked } from '@/lib/page-data';

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
   * 週別のときは「前の期間の同じ週」の文言が辞書にないので、これを渡す。
   */
  fixedRowText?: (point: LineChartPoint) => string;
  /**
   * 公開本数の添え書き（例: 「。この日に 2 本公開」）。本数が 1 以上の点で、固定行の文の後ろに足す。
   * fixedRowText を渡したときは使わない。
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
  /** 凡例の文言（辞書にキーがないので props で受ける）。 */
  labels: {
    /** この記事（実線）。 */
    post: string;
    /** 多くの記事はこの範囲（面）。 */
    band: string;
    /** 真ん中の記事（点線）。 */
    median: string;
  };
  /** 横軸の目盛りの文言（例: 30 → 「30 日目」）。 */
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
  /** 凡例の文言（例: 「細い枠: 前の期間」「細い枠: サイト全体」）。 */
  legend: string;
  /** 区分ごとの添え書き（例: 「61%」→「前: 61%」）。省略すると数字は添えない。 */
  text?: (share: string) => string;
};

export type HBarProps = {
  /** 図の説明（<title>）。 */
  title: string;
  items: readonly HBarItem[];
  /** 構成比の分母（その指標の合計の列）。20 未満か伏せ値なら、比率も棒も出さない。 */
  total: Masked;
  /** 「1,218（42%）」の形を作る（辞書にキーがないので props で受ける）。 */
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
  row: number;
  col: number;
  rowLabel: string;
  colLabel: string;
  /** null は伏せ値。 */
  value: Masked;
};

export type HeatmapProps = {
  /** 図の説明。<title> と、キーボード操作の領域の名前に使う。 */
  title: string;
  rowLabels: readonly string[];
  colLabels: readonly string[];
  /** values[行][列]。null は伏せ値。 */
  values: readonly (readonly Masked[])[];
  /** 固定行の文（選んだセル）。伏せ値のセルの文も、この関数が作る。 */
  cellText: (cell: HeatmapCell) => string;
  /** 固定行の上の案内（例: 「マスをタップすると、その時間の数字に変わります」）。 */
  hint: string;
  /** 濃淡の凡例の文言（例: legend.heatmap）。 */
  legend: string;
  /** 最初に選んでおくセル。既定は、値がいちばん大きいセル（なければ左上）。 */
  defaultCell?: { row: number; col: number };
  /** セルの中の数字の書式。既定は formatNumber（整数）。平均のときは小数の書式を渡せる。 */
  formatValue?: (value: number) => string;
  /** 列の見出しを何列おきに出すか（24 列なら 3 など）。既定は 1（すべて）。 */
  colLabelEvery?: number;
};
