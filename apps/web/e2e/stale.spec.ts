import { expect, test } from '@playwright/test';

import { dictionary } from '../src/lib/ui-text';

/**
 * データ更新の遅れ（07 §6 の E-18。FR-02、NFR-90）。
 *
 * 遅れたデータ（pub_meta.is_stale = true）でビルドしたときだけ動かす。手順（README にもある）:
 *   1. apps/batch で  PYTHONPATH="src;tests" .venv/Scripts/python.exe -m support.load_e2e_fixture --stale
 *   2. apps/web で    pnpm run build
 *   3. apps/web で    pnpm run e2e:stale（E2E_STALE=1 を付けて、この spec だけを流す）
 *   4. 1 を --stale なしで流し、pnpm run build をやり直して元に戻す
 * ふだんの `pnpm run e2e` では skip になる。
 */

const STALE = process.env.E2E_STALE === '1';

// 「更新が遅れています: 最新のデータは 」まで（日付の前）。
const DELAYED_HEAD = dictionary['status.delayed'].split('{')[0] ?? '';
// DataStatus の文の、日付を差し込んだあとに続く部分。
const AS_OF_TAIL = dictionary['status.asOf'].split(/\{[A-Za-z]+\}/).at(-1) ?? '';

test.describe('データ更新の遅れ（E-18）', () => {
  test.skip(!STALE, 'E2E_STALE=1 のときだけ動かす（遅れたフィクスチャでビルドしたとき）');

  test('E-18: is_stale のとき、どの画面の DataStatus にも「更新が遅れています」が出る', async ({
    page,
  }) => {
    expect(DELAYED_HEAD).toContain('更新が遅れています');
    for (const path of [
      '/',
      '/articles',
      '/articles/111',
      '/authors',
      '/activity',
      '/no-such-page',
    ]) {
      await page.goto(path);
      const delayed = page.getByText(DELAYED_HEAD);
      await expect.soft(delayed, `${path} の遅れの表示`).toHaveCount(1);
      await expect.soft(delayed.first(), `${path} の遅れの表示が見える`).toBeVisible();
      // 「◯月◯日までのデータです」も残り、遅れの文と同じ日付を指す。
      const asOf = page.getByText(AS_OF_TAIL);
      await expect.soft(asOf, `${path} の DataStatus`).toHaveCount(1);
      const date = /^(\d+ 月 \d+ 日)/.exec((await asOf.first().innerText()).trim())?.[1] ?? '';
      expect.soft(date, `${path} の基準日`).not.toBe('');
      expect.soft(await delayed.first().innerText(), `${path} の遅れの文の日付`).toContain(date);
      // main の外（ヘッダの直下）にある。
      await expect.soft(page.locator('main').getByText(DELAYED_HEAD)).toHaveCount(0);
    }
  });

  test('E-18: 遅れの表示は、配信される HTML に入っている（スクリプトなしでも読める）', async ({
    request,
  }) => {
    for (const path of ['/', '/articles/111', '/no-such-page']) {
      const html = await (await request.get(path)).text();
      expect.soft(html, `${path} の HTML`).toContain(DELAYED_HEAD.trim());
    }
  });
});
