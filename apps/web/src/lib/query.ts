/**
 * URL のクエリの許可リスト検証（04 §8、NFR-91、FR-03、U-18）。
 *
 * - 許可されない値は無視して既定値にする。エラーにしない。
 * - パラメータは 1 つずつ判定する（1 つの不正値でほかを捨てない）。
 * - 未知のパラメータと、その画面が使わないパラメータは落とす。
 * - 値は比較と一覧の照合にだけ使う。問い合わせや HTML に文字列として埋め込まない。
 * - どちらも純粋な関数。URL への書き戻し（history.replaceState）は呼び出し側が行う。
 */
import { DEFAULT_PERIOD_ID } from '@/lib/config';
import type { SelectablePeriodId } from '@/lib/page-data';

/** 画面の種類（05 §1 の ID）。 */
export type QueryScreen =
  | 's01'
  | 's02a'
  | 's02b'
  | 's02c'
  | 's02d'
  | 's02e'
  | 's03'
  | 's04'
  | 's05'
  | 's06'
  | 's06b'
  | 's07'
  | 's07b'
  | 's08'
  | 's10a'
  | 's10b'
  | 's10c'
  | 's10d'
  | 's10e';

/** 画面の種類と、埋め込んだデータから作る許可リスト。 */
export type QueryAllow = {
  screen: QueryScreen;
  /** periods[].id（選べる期間だけ。prev* は含めない）。 */
  periodIds: readonly string[];
  /** 絞り込みに出すカテゴリ（S-02e / S-10e。そのタブの親とその子だけ）。parentId が null でないものが子カテゴリ。 */
  categories?: readonly { id: number; parentId: number | null }[];
  /** authors[].slug（S-02e）。 */
  authorSlugs?: readonly string[];
  /** posts[].publishedOn の年月（'YYYY-MM'。S-02e）。 */
  publishedMonths?: readonly string[];
};

/** 並び。published は既定（公開日の新しい順）で、URL には書かない。 */
export type SortKey = 'published' | 'pv' | 'pv7' | 'pv30';

/** 検証済みの状態。その画面が使わないパラメータは既定値になる。 */
export type QueryState = {
  p: SelectablePeriodId;
  cat: number | null;
  author: string | null;
  ym: string | null;
  q: string | null;
  sort: SortKey;
  n: 20 | 50;
  line: 'pv' | 'sessions';
  heat: 'avg' | 'sum';
  axis: 'parent' | 'child';
};

type ParamName = keyof QueryState;

/** 既定値（04 §8 の「既定」の列）。 */
export const DEFAULT_QUERY_STATE: Readonly<QueryState> = Object.freeze({
  p: DEFAULT_PERIOD_ID,
  cat: null,
  author: null,
  ym: null,
  q: null,
  sort: 'published',
  n: 20,
  line: 'pv',
  heat: 'avg',
  axis: 'parent',
});

/** URL に書く順。 */
const PARAM_ORDER = [
  'p',
  'cat',
  'author',
  'ym',
  'q',
  'sort',
  'n',
  'line',
  'heat',
  'axis',
] as const satisfies readonly ParamName[];

/** パラメータを使う画面（04 §8 の「使う画面」の列）。p は全画面。 */
const PARAM_SCREENS: Readonly<Record<Exclude<ParamName, 'p'>, readonly QueryScreen[]>> = {
  cat: ['s02e', 's10e'],
  author: ['s02e', 's10e'],
  ym: ['s02e', 's10e'],
  q: ['s02e', 's10e'],
  sort: ['s02e', 's10e', 's05'],
  n: ['s02a', 's02c', 's10a', 's10c'],
  line: ['s01'],
  heat: ['s01'],
  axis: ['s06b'],
};

/**
 * 著者の slug と、記事・カテゴリ・タグの ID の形。リンクを作る側（SiteLinks、画面）、
 * 動的なパスの入口（src/app の page.tsx）、URL のクエリ、データの組み立てで同じ定義を使う
 * （監査 2026-11-05-build3-review.md L-2。場所ごとに違うと、リンクは出るのに 404 になる）。
 */
export const SLUG_PATTERN = /^[a-z0-9-]{1,64}$/;
export const ID_PATTERN = /^[1-9][0-9]{0,9}$/;

/** ID_PATTERN の形に合う正の整数か（リンクを作る前に確かめる）。 */
export function isValidId(id: number): boolean {
  return Number.isSafeInteger(id) && ID_PATTERN.test(String(id));
}

// 04 §8 の「形式」の列。
const PERIOD_PATTERN = /^(last7|last28|last90|m\d{4}-(0[1-9]|1[0-2]))$/;
const CATEGORY_PATTERN = ID_PATTERN;
const AUTHOR_PATTERN = SLUG_PATTERN;
const YEAR_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const SORT_PATTERN = /^(pv|pv7|pv30)$/;
const COUNT_PATTERN = /^(20|50)$/;
const LINE_PATTERN = /^(pv|sessions)$/;
const HEAT_PATTERN = /^(avg|sum)$/;
const AXIS_PATTERN = /^(parent|child)$/;
const SEARCH_TEXT_MAX_LENGTH = 50;

type RawReader = (name: ParamName) => string | null;

/** 形式に合う値だけを返す。合わなければ null。 */
function matching(value: string | null, pattern: RegExp): string | null {
  return value !== null && pattern.test(value) ? value : null;
}

/** タイトル検索の文字列。NFC に正規化し、前後の空白を除いて、長さ 1〜50（文字数）。 */
function searchText(value: string | null): string | null {
  if (value === null) return null;
  const text = value.normalize('NFC').trim();
  const length = [...text].length;
  return length >= 1 && length <= SEARCH_TEXT_MAX_LENGTH ? text : null;
}

function validate(read: RawReader, allow: QueryAllow): QueryState {
  const used = (name: Exclude<ParamName, 'p'>): boolean =>
    PARAM_SCREENS[name].includes(allow.screen);
  const readUsed = (name: Exclude<ParamName, 'p'>): string | null =>
    used(name) ? read(name) : null;

  // 期間。無効なら既定に戻すだけで、ほかのパラメータは個別に判定する。
  const period = matching(read('p'), PERIOD_PATTERN);
  const p =
    period !== null && allow.periodIds.includes(period)
      ? (period as SelectablePeriodId)
      : DEFAULT_QUERY_STATE.p;

  const categoryText = matching(readUsed('cat'), CATEGORY_PATTERN);
  const category =
    categoryText === null
      ? undefined
      : allow.categories?.find((item) => item.id === Number(categoryText));

  const authorText = matching(readUsed('author'), AUTHOR_PATTERN);
  const author =
    authorText !== null && (allow.authorSlugs?.includes(authorText) ?? false) ? authorText : null;

  const yearMonth = matching(readUsed('ym'), YEAR_MONTH_PATTERN);
  const ym =
    yearMonth !== null && (allow.publishedMonths?.includes(yearMonth) ?? false) ? yearMonth : null;

  // 並べ替え。S-05 は常に受け付ける。S-02e は、著者、子カテゴリ、公開年月のどれかで
  // 絞ったあとだけ（親カテゴリだけ、絞り込みなしのときは無視。FR-24、NFR-98）。
  const sortText = matching(readUsed('sort'), SORT_PATTERN);
  const isNarrowed =
    author !== null || ym !== null || (category !== undefined && category.parentId !== null);
  const sort =
    sortText !== null && (allow.screen === 's05' || isNarrowed)
      ? (sortText as SortKey)
      : DEFAULT_QUERY_STATE.sort;

  return {
    p,
    cat: category?.id ?? null,
    author,
    ym,
    q: used('q') ? searchText(read('q')) : null,
    sort,
    n: matching(readUsed('n'), COUNT_PATTERN) === '50' ? 50 : DEFAULT_QUERY_STATE.n,
    line: matching(readUsed('line'), LINE_PATTERN) === 'sessions' ? 'sessions' : 'pv',
    heat: matching(readUsed('heat'), HEAT_PATTERN) === 'sum' ? 'sum' : 'avg',
    axis: matching(readUsed('axis'), AXIS_PATTERN) === 'child' ? 'child' : 'parent',
  };
}

/**
 * URL のクエリ（location.search の文字列か URLSearchParams）を、検証済みの状態にする。
 * 同じ名前が複数あるときは、最初の値だけを見る。
 */
export function parseQuery(search: string | URLSearchParams, allow: QueryAllow): QueryState {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  return validate((name) => params.get(name), allow);
}

/**
 * 状態を URL のクエリ文字列（先頭の「?」なし）に戻す。
 *
 * 書く前にもう一度検証するので、検証済みの値だけが出る。既定値と、その画面が使わない
 * パラメータは書かない。すべて既定値なら空の文字列を返す。
 */
export function toQueryString(state: QueryState, allow: QueryAllow): string {
  const raw: Record<ParamName, string | null> = {
    p: state.p,
    cat: state.cat === null ? null : String(state.cat),
    author: state.author,
    ym: state.ym,
    q: state.q,
    sort: state.sort,
    n: String(state.n),
    line: state.line,
    heat: state.heat,
    axis: state.axis,
  };
  const valid = validate((name) => raw[name], allow);
  const params = new URLSearchParams();
  for (const name of PARAM_ORDER) {
    const value = valid[name];
    if (value !== null && value !== DEFAULT_QUERY_STATE[name]) params.set(name, String(value));
  }
  return params.toString();
}
