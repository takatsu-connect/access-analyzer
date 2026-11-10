import { gtagScriptUrl } from '@/lib/analytics';

/**
 * gtag.js を読み込む script 要素（FR-77、ADR 0013）。script 要素を描けるのは、この部品だけ
 * （eslint.config.mjs の access-analyzer/ga-script）。中身のないインラインでない script で、
 * src は検査済みの測定 ID から作る Google の固定の URL だけ。初期化は GaPageView が行う。
 */
export function GaScript({ measurementId }: { measurementId: string }) {
  return <script async src={gtagScriptUrl(measurementId)} />;
}
