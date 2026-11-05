import type { NextConfig } from 'next';

// 応答ヘッダ（docs/design/06_security.md §6、NFR-91）。CSP の値はこの定数だけに書く。
//
// script-src の 'unsafe-inline' は ADR 0010 の判断（レビュー中。依頼者の確認の前）。App Router の
// 静的生成は HTML にインラインの script（RSC のデータ）を出し、'self' だけではハイドレーションが
// 止まるため（e2e/csp.spec.ts で確認）。かわりに、値を HTML として描く出口を lint で塞ぐ
// （eslint.config.mjs）。'unsafe-inline' を許すのは script-src だけで、'unsafe-eval' は足さない。
// script-src-attr 'none' は、イベントハンドラの属性（onerror= など）の実行を止める。
// style-src は 'self' に確定済み（ADR 0008）。
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "script-src-attr 'none'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: CONTENT_SECURITY_POLICY },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // 画像の最適化（sharp）を使わない。図は自前の SVG 部品で描く（ADR 0008）。
  images: { unoptimized: true },
  async headers() {
    return [{ source: '/(.*)', headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
