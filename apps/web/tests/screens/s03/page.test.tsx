import { isValidElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildArticleDetail } from '@/data/pages';

import { BUILT_AT, makeCache } from '../../data/fixture';

// ページ（src/app/articles/[postId]/page.tsx）の入口の検査。
// データの入口（@/data）は Supabase を読むので、ここでは差し替える。

const NOT_FOUND = 'NEXT_NOT_FOUND';

const mocks = vi.hoisted(() => ({
  getArticleDetailData: vi.fn(),
  getArticleIds: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock('@/data', () => ({
  getArticleDetailData: mocks.getArticleDetailData,
  getArticleIds: mocks.getArticleIds,
}));
vi.mock('next/navigation', () => ({ notFound: mocks.notFound }));

const page = await import('@/app/articles/[postId]/page');

function params(postId: string): { params: Promise<{ postId: string }> } {
  return { params: Promise.resolve({ postId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.notFound.mockImplementation(() => {
    throw new Error(NOT_FOUND);
  });
  mocks.getArticleIds.mockResolvedValue([101, 102]);
  mocks.getArticleDetailData.mockImplementation((postId: number) =>
    Promise.resolve(buildArticleDetail(makeCache(), postId, BUILT_AT)),
  );
});

describe('S-03 記事詳細: ページの入口', () => {
  it('一覧にある記事だけを静的生成する（ID は文字列で渡す）', async () => {
    expect(page.dynamicParams).toBe(false);
    await expect(page.generateStaticParams()).resolves.toEqual([
      { postId: '101' },
      { postId: '102' },
    ]);
  });

  it.each(['abc', '0', '01', '-1', '1.5', '1e3', ' 102', '102 ', '12345678901', ''])(
    '記事の ID の形でない「%s」は、問い合わせずに 404 にする',
    async (postId) => {
      await expect(page.default(params(postId))).rejects.toThrow(NOT_FOUND);
      expect(mocks.getArticleDetailData).not.toHaveBeenCalled();
    },
  );

  it('形は正しいが記事がない ID は 404 にする', async () => {
    await expect(page.default(params('999'))).rejects.toThrow(NOT_FOUND);
    expect(mocks.getArticleDetailData).toHaveBeenCalledWith(999);
  });

  it('記事があれば、数にした ID でデータを取り、画面の部品に渡す', async () => {
    const element = await page.default(params('102'));
    expect(mocks.getArticleDetailData).toHaveBeenCalledWith(102);
    expect(mocks.notFound).not.toHaveBeenCalled();
    expect(isValidElement<{ data: { post: { id: number } } }>(element)).toBe(true);
    if (!isValidElement<{ data: { post: { id: number } } }>(element)) return;
    expect(element.props.data.post.id).toBe(102);
  });

  it('title に、記事のタイトルを文字列として入れる', async () => {
    await expect(page.generateMetadata(params('102'))).resolves.toEqual({ title: '記事 102' });
    await expect(page.generateMetadata(params('abc'))).resolves.toEqual({});
  });
});
