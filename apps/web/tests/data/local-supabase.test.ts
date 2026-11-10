/**
 * ローカルの Supabase（フィクスチャ入り）に対する確認。
 *
 * SUPABASE_URL が http://127.0.0.1 か http://localhost のときだけ動かす。それ以外（未設定、本番）は skip。
 * 接続先とキーは出力しない。出力するのは件数と大きさだけ。
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import {
  buildActivity,
  buildArticleDetail,
  buildArticleList,
  buildAuthorIndex,
  buildAuthorPage,
  buildCategories,
  buildDashboard,
  buildSeasonal,
  buildTagIndex,
  buildTagPage,
  listArticleIds,
  listAuthorSlugs,
  listTagIds,
} from '@/data/pages';
import { loadAll, VIEWS } from '@/data/pub';
import { BENCHMARK_SCOPES } from '@/lib/derive';
import type { ArticleListKind } from '@/lib/page-data';
import type { PubCache } from '@/lib/pub-types';

const envFile = fileURLToPath(new URL('../../.env.local', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

function isLocalUrl(value: string | undefined): boolean {
  if (value === undefined) return false;
  if (!value.startsWith('http://127.0.0.1') && !value.startsWith('http://localhost')) return false;
  try {
    const { hostname } = new URL(value);
    return hostname === '127.0.0.1' || hostname === 'localhost';
  } catch {
    return false;
  }
}

const { SUPABASE_URL: supabaseUrl } = process.env;
const BUILT_AT = new Date('2026-11-05T00:00:00Z');
const LIST_KINDS: ArticleListKind[] = ['top', 'new', 'long', 'recent', 'search'];

/** 埋め込み JSON の大きさの目安（04 §6。raw のバイト数）。 */
const LIMIT_BYTES = 60_000;
const LIMIT_BYTES_ARTICLE = 50_000;

function bytesOf(data: unknown): number {
  return Buffer.byteLength(JSON.stringify(data), 'utf8');
}

function report(lines: string[]): void {
  process.stdout.write(`\n${lines.join('\n')}\n`);
}

describe.skipIf(!isLocalUrl(supabaseUrl))('ローカルの Supabase', () => {
  let cache: PubCache;

  beforeAll(async () => {
    cache = await loadAll();
  }, 120_000);

  it('全ビューを読める', () => {
    const lines = ['[pub] 読んだビューと行数'];
    let total = 0;
    for (const [key, spec] of Object.entries(VIEWS)) {
      const value = cache[key as keyof PubCache];
      const rows = Array.isArray(value) ? value.length : 1;
      total += rows;
      lines.push(`  ${spec.name}: ${rows}`);
    }
    lines.push(`  合計: ${Object.keys(VIEWS).length} ビュー、${total} 行`);
    report(lines);

    expect(cache.meta.base_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(cache.posts.length).toBeGreaterThan(0);
    expect(cache.authors.length).toBeGreaterThan(0);
    expect(cache.periods.length).toBeGreaterThan(0);
    // 記事は post_id の昇順で読めている。
    const postIds = cache.posts.map((post) => post.post_id);
    expect(postIds).toEqual([...postIds].sort((a, b) => a - b));
    // 分布は scope が全体と記事の種類の行だけ。
    const scopes: readonly string[] = BENCHMARK_SCOPES;
    expect(cache.benchmarkCurve.every((row) => scopes.includes(row.scope))).toBe(true);
  });

  it('全ページの組み立てがスキーマを通り、大きさを記録する', () => {
    const sizes = new Map<string, { count: number; max: number }>();
    const record = (kind: string, data: unknown): void => {
      expect(data, kind).not.toBeNull();
      const entry = sizes.get(kind) ?? { count: 0, max: 0 };
      entry.count += 1;
      entry.max = Math.max(entry.max, bytesOf(data));
      sizes.set(kind, entry);
    };

    record('S-01 全体', buildDashboard(cache, BUILT_AT));
    for (const kind of LIST_KINDS) {
      record(`S-02 記事一覧（${kind}）`, buildArticleList(cache, kind, BUILT_AT));
    }
    for (const id of listArticleIds(cache)) {
      record('S-03 記事詳細', buildArticleDetail(cache, id, BUILT_AT));
    }
    record('S-04 著者一覧', buildAuthorIndex(cache, BUILT_AT));
    for (const slug of listAuthorSlugs(cache)) {
      record('S-05 著者ページ', buildAuthorPage(cache, slug, BUILT_AT));
    }
    record('S-06 カテゴリ', buildCategories(cache, BUILT_AT));
    record('S-06b 季節', buildSeasonal(cache, BUILT_AT));
    record('S-07 タグ一覧', buildTagIndex(cache, BUILT_AT));
    for (const id of listTagIds(cache)) {
      record('S-07b タグページ', buildTagPage(cache, id, BUILT_AT));
    }
    record('S-08 投稿活動', buildActivity(cache, BUILT_AT));

    // 目安を超えても落とさない。数字を報告に書く。
    const lines = ['[pages] 埋め込み JSON の大きさ（画面の種類ごとの最大。raw のバイト数）'];
    let pages = 0;
    for (const [kind, { count, max }] of sizes) {
      const limit = kind === 'S-03 記事詳細' ? LIMIT_BYTES_ARTICLE : LIMIT_BYTES;
      pages += count;
      lines.push(
        `  ${kind}: ${count} ページ、最大 ${max} B（目安 ${limit} B${max > limit ? '。超過' : ''}）`,
      );
    }
    lines.push(`  合計: ${pages} ページ`);

    // 記事が増えたときの見積もり用: 記事を探す画面の、記事 1 本あたりのバイト数。
    const search = buildArticleList(cache, 'search', BUILT_AT);
    const perPost = (bytesOf(search.posts) + bytesOf(search.pvByPeriod)) / search.posts.length;
    const fixedPart = bytesOf(search) - bytesOf(search.posts) - bytesOf(search.pvByPeriod);
    lines.push(
      `  記事を探す画面: 記事 1 本あたり ${Math.round(perPost)} B、記事によらない部分 ${fixedPart} B、期間 ${search.periods.length}`,
    );
    const preMeasure = search.posts.filter((post) => post.isPreMeasure).length;
    const ads = search.posts.filter((post) => post.isAd).length;
    lines.push(`  数え始める前に公開した記事 ${preMeasure} 本、広告 ${ads} 本`);
    const axes = buildCategories(cache, BUILT_AT).axes;
    lines.push(
      `  カテゴリの軸（順）: ${axes.map((axis) => `${axis.parent.name}（子 ${axis.children.length}）`).join(' / ')}`,
    );
    lines.push(
      `  記事 ${listArticleIds(cache).length} 本、著者 ${listAuthorSlugs(cache).length} 人（pub_author は ${cache.authors.length} 行）、タグ ${listTagIds(cache).length} 個（pub_tag は ${cache.tags.length} 行）`,
    );
    report(lines);

    expect(pages).toBeGreaterThan(listArticleIds(cache).length);
  });
});
