'use client';

import { useEffect } from 'react';

import { analyticsPageLocation } from '@/lib/analytics';

import { useRenderedPathname } from './useRenderedPathname';

type Gtag = (...args: unknown[]) => void;
type GaWindow = Window & { dataLayer?: unknown[]; gtag?: Gtag };

/**
 * gtag を用意して返す。gtag.js は、dataLayer に積まれた arguments（配列ではない）を命令として読む。
 * gtag.js の読み込みより先に積んでおけば、読み込んだあとに順に処理される。
 */
function ensureGtag(): Gtag {
  const ga = window as GaWindow;
  if (ga.gtag) return ga.gtag;
  const dataLayer = (ga.dataLayer ??= []);
  ga.gtag = function gtag() {
    // prefer-rest-params はこのファイルだけ外している（eslint.config.mjs の access-analyzer/ga-page-view）。
    dataLayer.push(arguments);
  };
  return ga.gtag;
}

let configuredId: string | null = null;

/**
 * BI の閲覧を GA4 に送る（FR-77、ADR 0013）。表示するものはない。
 *
 * - 自動の page_view を止め（send_page_view: false）、パスが変わるたびに自分で送る。
 * - 送る URL はオリジンとパスだけ。クエリ（期間、並び順、検索語）とハッシュは送らない。
 * - 一覧にないパスは、静的な HTML と同じ /_not-found として送る（打ち込まれた文字列を送らない）。
 * - Google シグナルと広告のパーソナライズを使わない。
 */
export function GaPageView({ measurementId }: { measurementId: string }) {
  const pathname = useRenderedPathname();

  useEffect(() => {
    const gtag = ensureGtag();
    const pageLocation = analyticsPageLocation(window.location.origin, pathname);
    if (configuredId !== measurementId) {
      configuredId = measurementId;
      gtag('js', new Date());
      gtag('config', measurementId, {
        send_page_view: false,
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
        page_location: pageLocation,
      });
    }
    gtag('set', { page_location: pageLocation });
    gtag('event', 'page_view', { page_location: pageLocation });
  }, [measurementId, pathname]);

  return null;
}
