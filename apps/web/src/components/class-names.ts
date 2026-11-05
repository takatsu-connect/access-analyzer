/** クラス名をつなぐ。false、null、undefined、空の文字列は捨てる。 */
export function cx(...names: readonly (string | false | null | undefined)[]): string | undefined {
  const joined = names.filter((name) => typeof name === 'string' && name !== '').join(' ');
  return joined === '' ? undefined : joined;
}
