import { readFileSync } from 'node:fs';

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { KpiCard, KpiGrid } from '@/components/KpiCard';

const css = readFileSync('src/components/KpiCard.module.css', 'utf8');

describe('KpiCard と KpiGrid（05 §2.2、§2.6、レビュー C-15）', () => {
  it('既定の大きさは regular、並べ方は even', () => {
    const { container } = render(
      <KpiGrid>
        <KpiCard label="読まれた回数" value={1234} />
      </KpiGrid>,
    );
    expect(container.querySelector('[data-layout]')?.getAttribute('data-layout')).toBe('even');
    expect(container.querySelector('[data-size]')?.getAttribute('data-size')).toBe('regular');
    expect(container.textContent).toContain('1,234');
  });

  it('lead の並べ方では、2 枚目からを compact にできる', () => {
    const { container } = render(
      <KpiGrid layout="lead">
        <KpiCard label="読まれた回数" value={1234} />
        <KpiCard label="公開した記事の本数" value={5} size="compact" />
        <KpiCard label="読んだ人の数" value={678} size="compact" />
      </KpiGrid>,
    );
    expect(container.querySelector('[data-layout]')?.getAttribute('data-layout')).toBe('lead');
    const sizes = [...container.querySelectorAll('[data-size]')].map((card) =>
      card.getAttribute('data-size'),
    );
    expect(sizes).toEqual(['regular', 'compact', 'compact']);
  });

  it('狭い画面の lead は 2 列で、1 枚目だけ全幅。広い画面では全幅を戻す', () => {
    expect(css).toMatch(/\.lead \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
    expect(css).toMatch(/\.lead > :first-child \{\s*grid-column: 1 \/ -1;/);
    expect(css).toMatch(
      /@media \(min-width: 600px\) \{[^@]*\.lead > :first-child \{\s*grid-column: auto;/,
    );
  });

  it('compact は狭い画面だけで値を 24px（--font-size-xl）にする', () => {
    expect(css).toMatch(
      /@media \(max-width: 599\.98px\) \{[^@]*\.compact \.value \{\s*font-size: var\(--font-size-xl\);/,
    );
  });

  it('注記は 13px（--font-size-note）。12px にしない（レビュー C-14）', () => {
    expect(css).toMatch(/\.note \{[^}]*font-size: var\(--font-size-note\);/);
    const globals = readFileSync('src/app/globals.css', 'utf8');
    expect(globals).toContain('--font-size-note: 0.8125rem;');
  });
});
