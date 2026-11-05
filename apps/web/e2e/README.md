# e2e — Playwright の検査と、07 §6 の ID との対応

- 更新日: 2026-11-06
- 設計: docs/design/07_test_plan.md §6（E-01〜E-22）、§7（S-11、S-14）、ADR 0010（CSP）
- 動かし方と、フィクスチャの注意（基準日、ビルドのキャッシュ、E-18 の手順）は `apps/web/README.md`。

全画面の一覧（S-01〜S-08 と 404。記事詳細は通常・30 日未満・数え始める前・題名が HTML の形）と、CSP の期待値は `support/screens.ts` の 1 か所にある。データは `apps/batch/tests/support/e2e_fixture.py`。日付は基準日からの相対で確かめる（基準日は画面から読む）。

## 受入基準 → 検査

| 07 の ID         | 受入基準                                    | 検査（spec と題名の先頭）                                                                                                                            |
| ---------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| E-01             | NFR-91、NFR-21、06 §6                       | `headers.spec.ts` の「E-01:」6 件（CSP の指示の集合が定義と完全に一致、ほかのヘッダ、CSP 違反 0 件、style なし）。`csp.spec.ts`（S-01 の詳しい記録） |
| E-02             | NFR-21                                      | `headers.spec.ts` の「E-02:」2 件                                                                                                                    |
| E-03             | FR-06、FR-23、FR-30、NFR-91                 | `routes.spec.ts` の「E-03:」2 件                                                                                                                     |
| E-04             | NFR-42                                      | `scripts/check-build-output.mjs`（`pnpm run check:build`）                                                                                           |
| E-05             | NFR-94                                      | `routes.spec.ts` の「E-05:」2 件                                                                                                                     |
| E-06             | FR-01、FR-03、FR-06、NFR-91                 | `period.spec.ts` の「E-06:」5 件（CSP 違反の 1 件は WebKit だけ fixme。PeriodPicker の select で style-src-attr の違反が出る）                       |
| E-07             | FR-24、NFR-98                               | `tables.spec.ts` の「E-07:」3 件                                                                                                                     |
| E-08             | NFR-36、FR-51                               | `tables.spec.ts` の「E-08:」2 件                                                                                                                     |
| E-09             | FR-73、NFR-33、NFR-96                       | `tables.spec.ts` の「E-09:」2 件                                                                                                                     |
| E-10             | NFR-96、FR-01                               | `tables.spec.ts` の「E-10:」2 件と fixme 1 件（前の期間の値がちょうど 20 の場面がフィクスチャにない）                                                |
| E-11             | NFR-97                                      | `charts.spec.ts` の「E-11:」2 件                                                                                                                     |
| E-12             | NFR-97、NFR-99                              | `wording.spec.ts` の 3 件                                                                                                                            |
| E-13             | NFR-81、NFR-99                              | `narrow.spec.ts` の 6 件（viewport 360 × 740）                                                                                                       |
| E-14             | NFR-99                                      | `routes.spec.ts` の「E-14:」2 件（2 件めは、全ページが同じ時点のデータであること）                                                                   |
| E-15             | FR-30、NFR-35                               | `tables.spec.ts` の「E-15:」1 件                                                                                                                     |
| E-16             | FR-04、NFR-91                               | `routes.spec.ts` の「E-16:」2 件                                                                                                                     |
| E-17             | NFR-10、NFR-12                              | HTML の大きさだけ: `scripts/check-build-output.mjs`。Lighthouse（LCP）は未実施                                                                       |
| E-18             | FR-02、NFR-90                               | `stale.spec.ts` の 2 件（`pnpm run e2e:stale`。ふだんは skip）                                                                                       |
| E-19             | FR-11、M-26、Q-35                           | `charts.spec.ts` の「E-19:」6 件                                                                                                                     |
| E-20             | FR-13、FR-15、FR-23                         | `period.spec.ts` の「E-20:」3 件と fixme 1 件（文言が文書どうしで食い違う）                                                                          |
| E-21             | NFR-80                                      | `playwright.config.ts` の webkit と firefox（E-05〜E-09 だけ。`pnpm run e2e:browsers`）                                                              |
| E-22             | FR-23、FR-31、FR-51、NFR-36、NFR-94〜NFR-99 | `review.spec.ts` の 9 件                                                                                                                             |
| S-11             | NFR-91                                      | `scripts/check-headers.mjs`（`pnpm run check:headers`）                                                                                              |
| S-14             | NFR-42、NFR-10                              | `scripts/check-build-output.mjs`（`pnpm run check:build`）                                                                                           |
| ADR 0010 の 5、8 | NFR-91                                      | `inline-script.spec.ts` の 9 件（インラインの script の形、イベント属性、`script-src-attr 'none'`、HTML の形の題名と名前）                           |

## 書くときの決まり

- 文言は辞書から引く（`import { t } from '../src/lib/ui-text'`）。画面の不具合を見つけたら、期待値をゆるめずに `test.fixme` にして理由をコメントに書く。
- 外部には接続しない。`innerHTML` と `Array.from(` は lint が止める（`evaluate` の中でも）。
