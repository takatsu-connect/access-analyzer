import { render } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DataStatus } from '@/components/DataStatus';

const DELAYED = '更新が遅れています';
const FINISHED_AT = '2026-11-04T18:05:00+09:00';

describe('DataStatus（U-25）', () => {
  beforeEach(() => {
    // JST の 2026-11-05 に時計を固定する。
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-05T09:00:00+09:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('基準日と更新の時刻、直近の数字の注意を出す', () => {
    const { container } = render(
      <DataStatus meta={{ baseDate: '2026-11-03', finishedAt: FINISHED_AT, isStale: false }} />,
    );
    expect(container.textContent).toBe(
      '11 月 3 日までのデータです（11 月 4 日 18:05 更新）。直近 2〜3 日の数字はあとで増えることがあります。',
    );
  });

  it('今日 − 基準日 が 2 日なら、遅れの知らせを出さない', () => {
    const { container } = render(
      <DataStatus meta={{ baseDate: '2026-11-03', finishedAt: FINISHED_AT, isStale: false }} />,
    );
    expect(container.textContent).not.toContain(DELAYED);
  });

  it('今日 − 基準日 が 3 日なら、遅れの知らせを出す', () => {
    const { container } = render(
      <DataStatus meta={{ baseDate: '2026-11-02', finishedAt: FINISHED_AT, isStale: false }} />,
    );
    expect(container.textContent).toContain(
      '更新が遅れています: 最新のデータは 11 月 2 日までです',
    );
  });

  it('isStale なら、日数に関係なく遅れの知らせを出す', () => {
    const { container } = render(
      <DataStatus meta={{ baseDate: '2026-11-04', finishedAt: FINISHED_AT, isStale: true }} />,
    );
    expect(container.textContent).toContain(DELAYED);
  });

  it('サーバーで描く HTML は「今日」を使わない（isStale だけで決まる）', () => {
    const fresh = renderToString(
      <DataStatus meta={{ baseDate: '2026-11-02', finishedAt: FINISHED_AT, isStale: false }} />,
    );
    const stale = renderToString(
      <DataStatus meta={{ baseDate: '2026-11-04', finishedAt: FINISHED_AT, isStale: true }} />,
    );
    expect(fresh).not.toContain(DELAYED);
    expect(stale).toContain(DELAYED);
  });
});
