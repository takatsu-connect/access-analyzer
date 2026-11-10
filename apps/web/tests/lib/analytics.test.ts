import { describe, expect, it } from 'vitest';

import {
  analyticsPageLocation,
  gtagScriptUrl,
  parseMeasurementId,
  TARGET_SITE_MEASUREMENT_ID,
} from '@/lib/analytics';
import { buildContentSecurityPolicy } from '@/lib/csp';

// FR-77、ADR 0013。
describe('parseMeasurementId', () => {
  it('未設定と空白だけは計測しない（null）', () => {
    expect(parseMeasurementId(undefined)).toBeNull();
    expect(parseMeasurementId('')).toBeNull();
    expect(parseMeasurementId('  ')).toBeNull();
  });

  it('G- で始まる英大文字と数字を通す（前後の空白は落とす）', () => {
    expect(parseMeasurementId('G-ABC123XYZ9')).toBe('G-ABC123XYZ9');
    expect(parseMeasurementId(' G-ABC123XYZ9\n')).toBe('G-ABC123XYZ9');
  });

  it.each([
    'UA-12345-1',
    'g-abc123xyz9',
    'G-ABC',
    'G-ABC123XYZ9"><x',
    'G-ABC123&x=1',
    'GTM-ABC1234',
  ])('形の違う値（%s）はビルドを止める', (value) => {
    expect(() => parseMeasurementId(value)).toThrow();
  });

  it('高津コネクト本体の測定 ID は使えない', () => {
    expect(() => parseMeasurementId(TARGET_SITE_MEASUREMENT_ID)).toThrow();
  });
});

describe('gtagScriptUrl', () => {
  it('googletagmanager.com の固定のパスに測定 ID を付ける', () => {
    expect(gtagScriptUrl('G-ABC123XYZ9')).toBe(
      'https://www.googletagmanager.com/gtag/js?id=G-ABC123XYZ9',
    );
  });
});

describe('analyticsPageLocation', () => {
  it('オリジンとパスだけを返す', () => {
    expect(analyticsPageLocation('https://example.vercel.app', '/articles/123')).toBe(
      'https://example.vercel.app/articles/123',
    );
    expect(analyticsPageLocation('https://example.vercel.app', 'tags')).toBe(
      'https://example.vercel.app/tags',
    );
  });
});

describe('buildContentSecurityPolicy', () => {
  const directives = (csp: string) => csp.split('; ');

  it('計測しないときは 2026-11-07 の値のまま', () => {
    expect(directives(buildContentSecurityPolicy(false))).toEqual([
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
    ]);
  });

  it('計測するときは script-src、img-src、connect-src にだけ Google の送り先を足す', () => {
    expect(directives(buildContentSecurityPolicy(true))).toEqual([
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com",
      "script-src-attr 'none'",
      "style-src 'self'",
      "img-src 'self' data: https://www.googletagmanager.com https://*.google-analytics.com",
      "font-src 'self'",
      "connect-src 'self' https://www.googletagmanager.com https://*.google-analytics.com https://*.google.com",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'none'",
    ]);
  });
});
