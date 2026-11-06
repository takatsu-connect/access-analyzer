import { isValidElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildAuthorPage } from '@/data/pages';

import { BUILT_AT, makeCache, SATO, TANAKA } from '../../data/fixture';

// ページ（src/app/authors/[slug]/page.tsx）の入口の検査。
// データの入口（@/data）は Supabase を読むので、ここでは差し替える。

const NOT_FOUND = 'NEXT_NOT_FOUND';

const mocks = vi.hoisted(() => ({
  getAuthorPageData: vi.fn(),
  getAuthorSlugs: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock('@/data', () => ({
  getAuthorPageData: mocks.getAuthorPageData,
  getAuthorSlugs: mocks.getAuthorSlugs,
}));
vi.mock('next/navigation', () => ({ notFound: mocks.notFound }));

const page = await import('@/app/authors/[slug]/page');

function params(slug: string): { params: Promise<{ slug: string }> } {
  return { params: Promise.resolve({ slug }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.notFound.mockImplementation(() => {
    throw new Error(NOT_FOUND);
  });
  mocks.getAuthorSlugs.mockResolvedValue([SATO, TANAKA]);
  mocks.getAuthorPageData.mockImplementation((slug: string) =>
    Promise.resolve(buildAuthorPage(makeCache(), slug, BUILT_AT)),
  );
});

describe('S-05 著者ページ: ページの入口', () => {
  it('一覧にある著者だけを静的生成する', async () => {
    expect(page.dynamicParams).toBe(false);
    await expect(page.generateStaticParams()).resolves.toEqual([{ slug: SATO }, { slug: TANAKA }]);
  });

  it.each(['Sato', 'sato_hanako', 'a'.repeat(65), '', 'sato/../x'])(
    'slug の形でない「%s」は、問い合わせずに 404 にする',
    async (slug) => {
      await expect(page.default(params(slug))).rejects.toThrow(NOT_FOUND);
      await expect(page.generateMetadata(params(slug))).resolves.toEqual({});
      expect(mocks.getAuthorPageData).not.toHaveBeenCalled();
    },
  );

  it('形は正しいが著者がいない slug は 404 にする', async () => {
    await expect(page.default(params('nobody'))).rejects.toThrow(NOT_FOUND);
    expect(mocks.getAuthorPageData).toHaveBeenCalledWith('nobody');
  });

  it('64 文字までの slug は形として受け付ける（著者がいなければ 404）', async () => {
    await expect(page.default(params('a'.repeat(64)))).rejects.toThrow(NOT_FOUND);
    expect(mocks.getAuthorPageData).toHaveBeenCalledWith('a'.repeat(64));
  });

  it('著者がいれば、slug でデータを取り、画面の部品に渡す', async () => {
    const element = await page.default(params(SATO));
    expect(mocks.getAuthorPageData).toHaveBeenCalledWith(SATO);
    expect(mocks.notFound).not.toHaveBeenCalled();
    expect(isValidElement<{ data: { author: { slug: string } } }>(element)).toBe(true);
    if (!isValidElement<{ data: { author: { slug: string } } }>(element)) return;
    expect(element.props.data.author.slug).toBe(SATO);
  });

  it('title は表示名で書き、slug を含まない', async () => {
    const metadata = await page.generateMetadata(params(SATO));
    expect(metadata).toEqual({ title: 'さとう はなこさんの記事' });
    expect(JSON.stringify(metadata)).not.toContain(SATO);
    await expect(page.generateMetadata(params('nobody'))).resolves.toEqual({});
  });
});
