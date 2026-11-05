/**
 * S-04 著者一覧（05 §6.1、FR-30、NFR-35）。
 * 名前だけを出し、数字を出さない。slug は href にだけ使う。
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';

import { buildAuthorIndex } from '@/data/pages';
import type { AuthorIndexData } from '@/lib/page-data';
import { AuthorIndexScreen } from '@/screens/s05/AuthorIndexScreen';

import { BUILT_AT, makeCache, SATO, TANAKA } from '../../data/fixture';

afterEach(cleanup);

function indexData(): AuthorIndexData {
  return buildAuthorIndex(makeCache(), BUILT_AT);
}

describe('S-04 著者一覧', () => {
  test('h1、案内、名前の順の注記を出す', () => {
    render(<AuthorIndexScreen data={indexData()} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('ライターのページ');
    expect(screen.getByText(/自分の名前を選ぶとページが開きます/)).toBeTruthy();
    expect(screen.getByText('名前の順に並んでいます。')).toBeTruthy();
  });

  test('項目は名前だけで、数字を含まない', () => {
    const { container } = render(<AuthorIndexScreen data={indexData()} />);
    const items = screen.getAllByRole('listitem');
    expect(items.length).toBe(2);
    for (const item of items) {
      expect(item.textContent).not.toMatch(/\d/);
    }
    // 画面のどこにも数字がない（本数、読まれた回数、日付を出していない）。
    expect(container.textContent).not.toMatch(/\d/);
  });

  test('slug は href にだけ使い、文字として出さない', () => {
    const data = indexData();
    const { container } = render(<AuthorIndexScreen data={data} />);
    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
    expect(hrefs).toContain(`/authors/${SATO}`);
    expect(hrefs).toContain(`/authors/${TANAKA}`);
    const text = container.textContent;
    for (const author of data.authors) {
      expect(text).not.toContain(author.slug);
    }
  });

  test('届いた順（名前の順）のまま並べる', () => {
    const data = indexData();
    render(<AuthorIndexScreen data={data} />);
    const names = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(names).toEqual(data.authors.map((author) => author.name));
    expect(names).toEqual([...names].sort((left, right) => left.localeCompare(right, 'ja')));
  });

  test('著者がいないときは、その旨の文を出す', () => {
    const data = { ...indexData(), authors: [] };
    render(<AuthorIndexScreen data={data} />);
    expect(screen.getByText('ライターのページは、まだありません。')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });

  test('style 属性を出さない', () => {
    const { container } = render(<AuthorIndexScreen data={indexData()} />);
    expect(container.querySelectorAll('*').length).toBeGreaterThan(0);
    expect(container.querySelector('[style]')).toBeNull();
  });
});
