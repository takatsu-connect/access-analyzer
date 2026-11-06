/**
 * 外部リンクの再検証（05 §2.7、06 §7、U-26）。
 */
import { SITE_ORIGIN } from '@/lib/config';

const ALLOWED_PREFIX = `${SITE_ORIGIN}/`;

/**
 * リンク先が https://takatsu-connect.com/ の配下ならそのまま返す。違えば null（リンクにしない）。
 * 先頭の一致に加えて、URL として解釈したオリジンも確かめる。
 */
export function safeExternalUrl(url: string | null | undefined): string | null {
  if (typeof url !== 'string' || !url.startsWith(ALLOWED_PREFIX)) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.origin !== SITE_ORIGIN || parsed.username !== '' || parsed.password !== '') {
    return null;
  }
  return url;
}

/**
 * 参照元ドメインとして画面に出してよい形か（監査 2026-11-05-build3-review.md L-3）。
 * 参照元は、第三者が偽の参照元でアクセスを重ねれば入れられる値なので、ドメインの形
 * （英数字、ハイフン、点。ラベルは 63 文字まで、全体は 253 文字まで）でないものは表から落とす。
 * GA4 の `(direct)` などの括弧つきの値も落とす。リンクにはしない（文字として描くだけ）。
 */
const DOMAIN_PATTERN =
  /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;

export function isDisplayableDomain(value: string): boolean {
  return DOMAIN_PATTERN.test(value);
}
