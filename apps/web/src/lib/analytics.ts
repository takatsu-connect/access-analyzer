/**
 * BI 自身の閲覧の計測（GA4。FR-77、ADR 0013）。
 *
 * 測定 ID は、ビルド時の環境変数 BI_GA4_MEASUREMENT_ID から読む（Vercel の Production だけに置く）。
 * 空なら計測しない（タグを出さず、CSP も広げない）。ローカル、E2E、CI、Preview はこの状態。
 *
 * next.config.ts からも読むので、このファイルは '@/' の別名や他のモジュールを import しない。
 */

/** 計測を有効にする環境変数の名前。秘密ではないが、ブラウザ向けの名前（NEXT_PUBLIC_）にはしない。 */
export const GA_MEASUREMENT_ID_ENV = 'BI_GA4_MEASUREMENT_ID';

/** 対象サイト（高津コネクト本体）の測定 ID。BI の閲覧を本体の数字に混ぜないため、使えなくする。 */
export const TARGET_SITE_MEASUREMENT_ID = 'G-79CFGF83VT';

/** gtag.js を配る場所（CSP の script-src に足すのはこの 1 つだけ）。 */
export const GTAG_SCRIPT_ORIGIN = 'https://www.googletagmanager.com';

/**
 * GA4 のために CSP に足す送り先（Google の CSP の案内のうち、広告の機能を使わない場合）。
 * 確認日 2026-11-10、https://developers.google.com/tag-platform/security/guides/csp
 */
export const GA_CSP_SOURCES = {
  script: [GTAG_SCRIPT_ORIGIN],
  img: [GTAG_SCRIPT_ORIGIN, 'https://*.google-analytics.com'],
  connect: [GTAG_SCRIPT_ORIGIN, 'https://*.google-analytics.com', 'https://*.google.com'],
} as const;

const MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]{6,12}$/;

/**
 * 環境変数の値を測定 ID として読む。空（未設定、空白だけ）なら null（計測しない）。
 * 形が違う値と、対象サイトの測定 ID は、ビルドを止めるために例外にする。
 */
export function parseMeasurementId(raw: string | undefined): string | null {
  const value = (raw ?? '').trim();
  if (value === '') return null;
  if (!MEASUREMENT_ID_PATTERN.test(value)) {
    throw new Error(`${GA_MEASUREMENT_ID_ENV} の形が違います（G- で始まる英大文字と数字）。`);
  }
  if (value === TARGET_SITE_MEASUREMENT_ID) {
    throw new Error(
      `${GA_MEASUREMENT_ID_ENV} に高津コネクト本体の測定 ID は使えません（ADR 0013）。`,
    );
  }
  return value;
}

/** ビルド時の環境から測定 ID を読む。 */
export function measurementIdFromEnv(): string | null {
  return parseMeasurementId(process.env[GA_MEASUREMENT_ID_ENV]);
}

/** gtag.js の URL。測定 ID は parseMeasurementId を通したものだけを渡す。 */
export function gtagScriptUrl(measurementId: string): string {
  return `${GTAG_SCRIPT_ORIGIN}/gtag/js?id=${encodeURIComponent(measurementId)}`;
}

/**
 * GA4 に送るページの URL。クエリ（期間、並び順、検索語）とハッシュを落とし、オリジンとパスだけにする。
 * 検索欄の語などの利用者の入力を Google に送らないため（ADR 0013）。
 */
export function analyticsPageLocation(origin: string, pathname: string): string {
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${origin}${path}`;
}
