/**
 * 「このページの数字について」（CommonNotes。05 §2.7）に、画面ごとに出す項目の表（助言 A-2）。
 *
 * その画面に出ている数字の説明だけを出す。どの画面にどの項目を出すかは、ここだけで決める。
 * 表にないパス（S-04 のライターの一覧、404）には何も出さない。
 */

/** 項目の ID。辞書の notes.* のキーに対応する（measureStart と band は「詳しく」を持つ）。 */
export type NoteId =
  'pageviews' | 'measureStart' | 'masked' | 'band' | 'ratio' | 'source' | 'posting';

/** 出す順。画面ごとの一覧も、この順に並べて返す。 */
export const NOTE_ORDER: readonly NoteId[] = [
  'posting',
  'pageviews',
  'measureStart',
  'masked',
  'band',
  'ratio',
  'source',
];

// 読まれた回数（GA4）を出す画面に共通の項目: 数え方、数え始め、伏せ値、出どころ。
const PAGEVIEWS: readonly NoteId[] = ['pageviews', 'measureStart', 'masked', 'source'];

type NoteRoute = { screen: string; pattern: RegExp; notes: readonly NoteId[] };

/**
 * パスの形 → 項目。上から順に見て、最初に合ったものを使う。
 * - 伏せ値: どの画面も、表（ArticleTable）か前の期間との比較（Delta）かヒートマップで「—」が出うる。
 * - 帯: 帯や真ん中の記事を出す画面（S-01、S-02b、S-03、S-05）。
 * - 比率（%）: 前の期間との比較や割合を出す画面。S-02 の記事の一覧は % を出さない。
 * - S-08 は公開本数（WordPress の記事）だけで、読まれた回数と GA4 の数字を出さない。
 */
export const NOTE_ROUTES: readonly NoteRoute[] = [
  { screen: 'S-01', pattern: /^\/$/, notes: [...PAGEVIEWS, 'band', 'ratio'] },
  { screen: 'S-02a', pattern: /^\/articles\/top$/, notes: PAGEVIEWS },
  { screen: 'S-02b', pattern: /^\/articles\/new$/, notes: [...PAGEVIEWS, 'band'] },
  { screen: 'S-02c', pattern: /^\/articles\/long$/, notes: PAGEVIEWS },
  { screen: 'S-02d', pattern: /^\/articles\/recent$/, notes: PAGEVIEWS },
  { screen: 'S-02e', pattern: /^\/articles$/, notes: PAGEVIEWS },
  { screen: 'S-03', pattern: /^\/articles\/[0-9]+$/, notes: [...PAGEVIEWS, 'band', 'ratio'] },
  { screen: 'S-04', pattern: /^\/authors$/, notes: [] },
  { screen: 'S-05', pattern: /^\/authors\/[^/]+$/, notes: [...PAGEVIEWS, 'band', 'ratio'] },
  { screen: 'S-06', pattern: /^\/categories$/, notes: [...PAGEVIEWS, 'ratio'] },
  { screen: 'S-06b', pattern: /^\/categories\/seasonal$/, notes: [...PAGEVIEWS, 'ratio'] },
  { screen: 'S-07', pattern: /^\/tags$/, notes: [...PAGEVIEWS, 'ratio'] },
  { screen: 'S-07b', pattern: /^\/tags\/[0-9]+$/, notes: [...PAGEVIEWS, 'ratio'] },
  { screen: 'S-08', pattern: /^\/activity$/, notes: ['posting', 'ratio'] },
];

/** 末尾の / を外す（/ だけはそのまま）。 */
function normalize(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

/** パス → 出す項目（NOTE_ORDER の順）。表にないパスは空。 */
export function notesFor(pathname: string): NoteId[] {
  const path = normalize(pathname);
  const route = NOTE_ROUTES.find((item) => item.pattern.test(path));
  if (route === undefined) return [];
  return NOTE_ORDER.filter((id) => route.notes.includes(id));
}
