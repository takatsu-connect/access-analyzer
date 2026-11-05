/**
 * 画面ごとの文言ファイル（s01.ts など）の型。
 *
 * キーは、その画面の接頭辞（'s01.' など）で始まる、点区切りの平らな文字列にする。
 * 接頭辞の違うキーを書くと、各ファイルの satisfies の検査でコンパイルエラーになる。
 */
export type ScreenTexts<Prefix extends string> = Readonly<Record<`${Prefix}.${string}`, string>>;
