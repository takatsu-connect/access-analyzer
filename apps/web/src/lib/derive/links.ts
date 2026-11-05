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
