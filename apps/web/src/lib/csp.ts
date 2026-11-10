/**
 * Content-Security-Policy の値（docs/design/06_security.md §6、NFR-91）。CSP の値はここだけに書く。
 *
 * script-src の 'unsafe-inline' は ADR 0010 の判断（2026-11-07 に確定）。App Router の
 * 静的生成は HTML にインラインの script（RSC のデータ）を出し、'self' だけではハイドレーションが
 * 止まるため（e2e/csp.spec.ts で確認）。かわりに、値を HTML として描く出口を lint で塞ぐ
 * （eslint.config.mjs）。'unsafe-inline' を許すのは script-src だけで、'unsafe-eval' は足さない。
 * script-src-attr 'none' は、イベントハンドラの属性（onerror= など）の実行を止める。
 * style-src は 'self' に確定済み（ADR 0008）。
 *
 * GA4 の計測が有効なとき（ADR 0013）だけ、script-src、img-src、connect-src に Google の送り先を足す。
 * 無効なら（ローカル、E2E、CI、Preview）2026-11-07 の値のまま。
 *
 * next.config.ts から読むので、'@/' の別名を使わない。
 */
import { GA_CSP_SOURCES } from './analytics';

export function buildContentSecurityPolicy(analyticsEnabled: boolean): string {
  const extra = (sources: readonly string[]) =>
    analyticsEnabled ? sources.map((source) => ` ${source}`).join('') : '';
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${extra(GA_CSP_SOURCES.script)}`,
    "script-src-attr 'none'",
    "style-src 'self'",
    `img-src 'self' data:${extra(GA_CSP_SOURCES.img)}`,
    "font-src 'self'",
    `connect-src 'self'${extra(GA_CSP_SOURCES.connect)}`,
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ');
}
