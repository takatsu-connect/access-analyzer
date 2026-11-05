import type { MetadataRoute } from 'next';

// 全パスをクロールの対象外にする（NFR-21、05 §2.7）。ビルド時に静的な robots.txt になる。
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', disallow: '/' },
  };
}
