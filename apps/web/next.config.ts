import type { NextConfig } from 'next';

import { measurementIdFromEnv } from './src/lib/analytics';
import { buildContentSecurityPolicy } from './src/lib/csp';

// 応答ヘッダ（docs/design/06_security.md §6、NFR-91）。CSP の値は src/lib/csp.ts だけに書く。
// GA4 の測定 ID（BI_GA4_MEASUREMENT_ID）があるときだけ、Google の送り先を足す（ADR 0013）。
const CONTENT_SECURITY_POLICY = buildContentSecurityPolicy(measurementIdFromEnv() !== null);

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
