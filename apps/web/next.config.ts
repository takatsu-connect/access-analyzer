import type { NextConfig } from 'next';

// D-17 の決定待ち。docs/design/adr に記録してから確定する。
// 仮の値として script-src に 'unsafe-inline' を入れている。App Router の静的生成は HTML に
// インラインの script（RSC のデータ）を出し、'self' だけではハイドレーションが止まるため
// （e2e/csp.spec.ts で確認）。style-src は 'self' に確定済み（ADR 0008）。
//
// 応答ヘッダ（docs/design/06_security.md §6、NFR-91）。CSP の値はこの定数だけに書く。
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
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
