# ADR 0010: CSP の `script-src`（静的生成のインラインスクリプト）

- 状態: レビュー中（2026-11-05。security-auditor の確認と依頼者の確認の前）
- 更新日: 2026-11-05
- 関係: NFR-91、06_security.md §6・§13（D-17）、ADR 0006（静的生成）、ADR 0008「結果」（`style-src` は確定、`script-src` は実装時に決める）、07_test_plan.md E-01・S-11
- 事実の出典:
  - 実機の検証（2026-11-05、構築 3）。Next.js 16.4.5（App Router、Turbopack）で `next build` → `next start` し、Playwright の Chromium で仮の 1 画面を開いた。検証のスクリプトは `apps/web/e2e/csp.spec.ts`
  - Next.js 公式文書 v16.2.9 `docs/01-app/02-guides/content-security-policy.mdx`（context7 で 2026-11-05 に確認）

## 文脈

- BI は全ページを静的生成し、実行時のサーバー処理を持たない（ADR 0006）。応答ヘッダは `next.config` の `headers()` で全パスに同じ値を付ける（06 §6）。
- 06 §6 の CSP は `script-src 'self'` を目標にしていたが、App Router の静的生成は HTML にインラインの `<script>` を出すので、成り立つかを実装時に確かめることにしていた（D-17）。
- この BI にはログインがなく、ブラウザに渡る秘密（Cookie、トークン、キー）もない。載っているのは公開ビューの値だけである。したがって、スクリプトを差し込まれたときの害は「訪問者に見せる内容の書き換え」と「訪問者を別のサイトへ送ること」で、秘密や個人のデータの持ち出しではない。

## 確かめた事実

3 通りの `script-src` で、同じ画面（Client Component を 1 つ持つ）を開いた。ほかのヘッダは 06 §6 のまま。

| | (a) `'self'` | (b) `'self'` + `experimental.sri` | (c) `'self' 'unsafe-inline'` |
| --- | --- | --- | --- |
| CSP 違反 | 3 件（すべてインラインの script） | 3 件（同じ） | 0 件 |
| クリックが効く（ハイドレーションの成否） | 効かない | 効かない | 効く |
| HTML のインライン script の数 | 3 | 3 | 3 |
| integrity の付いた外部 script | 0 | 7 本中 5 本 | 0 |
| HTML の style タグと style 属性 | 0 | 0 | 0 |

- インラインの script 3 本の中身: (1) チャンクのファイル名を登録する短い文、(2) `(self.__next_f=self.__next_f||[]).push([0])`、(3) `self.__next_f.push([1,"…"])`。3 本目は、そのページの RSC のデータとチャンクのファイル名を含む。
- (a) と (b) でブラウザが示したハッシュは、1 本目と 2 本目が同じで、3 本目が違った。3 本目はページとビルドの内容で変わる。
- `experimental.sri` は、外部の script に integrity を付けるだけだった。インラインの script は許されない。公式文書の SRI の例（`script-src 'self'`）は、静的生成のページではそのままでは動かない。
- 公式文書が、nonce を使わない場合の設定として示しているのは `script-src 'self' 'unsafe-inline'` である。
- `style-src 'self'` は 3 通りとも成り立った（ADR 0008 の決定のまま）。

確かめていないこと: ハッシュを並べた CSP の実機での動作、動的なパス（記事や著者のページ）でのインライン script の数、Vercel 上でのヘッダの付き方。

## 選択肢

| 案 | 内容 | 成り立つか |
| --- | --- | --- |
| A | `script-src 'self' 'unsafe-inline'` | 実機で成り立つ。公式の案内どおり |
| B | `script-src 'self'` + `experimental.sri` | 成り立たない（上の表） |
| C | ハッシュを並べる。ビルドのあとで全ページ（300〜350）の HTML からインライン script のハッシュを計算し、ページごとの CSP を配る | 未検証。配り方は (C1) HTML に `<meta http-equiv>` を差し込む、(C2) パスごとの応答ヘッダを生成する、の 2 通り |
| D | nonce | 毎リクエストのサーバー処理が要る。ADR 0006 と両立しない |
| E | Pages Router に変える（データは実行されない JSON として埋まる） | 未検証。設計（ADR 0004、0006、04、05）の作り直しになる |

## 比較（A と C）

| 観点 | A: `'unsafe-inline'` | C: ハッシュ |
| --- | --- | --- |
| 差し込まれたスクリプトを止める力 | インラインの script は止まらない。外部のスクリプトの読み込み（`script-src` に `'self'` 以外がない）、外部への送信（`connect-src 'self'`、`img-src 'self' data:`、`form-action 'none'`）、`<base>` の差し替え（`base-uri 'self'`）は止まる | インラインも止まる |
| 止めたい事故の入口 | HTML として解釈される形で値を描いてしまう不具合。入口は lint で塞いでいる（`dangerouslySetInnerHTML` と `style` prop の禁止、文言は辞書経由、値は React のテキストとして描く） | 同じ入口。塞ぎ漏れたときの二重の守りになる |
| 守るもの | 訪問者に見せる内容の正しさ。秘密はブラウザにない | 同じ |
| 壊れ方 | 壊れにくい。Next.js の出力が変わっても動く | ハッシュの計算か配布が 1 ページでもずれると、そのページは操作が効かなくなる（クリック、期間の切り替え）。無人で毎日ビルドするので、気づくのが遅れる |
| Next.js の更新への追従 | 不要 | インライン script の出し方が変わるたびに、計算のスクリプトを直す |
| 配り方の前提 | `headers()` のまま | (C1) ビルドの成果物を書き換える。Vercel がその成果物を配るかは未確認。(C2) Vercel のパスごとのヘッダの上限と、ビルドのあとで設定を作る方法が未確認 |
| 実装と保守 | なし | ビルド後のスクリプト、E2E での全ページの検査、失敗時の通知 |

## 決定（提案）

案 A を採る。`script-src 'self' 'unsafe-inline'`。

- 理由: 守るものが「見せる内容の正しさ」で、ブラウザに秘密がない。入口は lint と React の描き方で塞いである。案 C は二重の守りになるが、無人の日次ビルドで「一部のページだけ操作が効かない」という気づきにくい壊れ方を持ち込み、運用の負荷（NFR-70）に見合わないと判断した。
- 案 A を採るかわりに、次を守る。
  1. アプリのコードはインラインの script を足さない。JSX の `<script>` と `next/script` を lint で禁止する。
  2. `dangerouslySetInnerHTML`、`style` prop、JSX のリテラル文言の禁止（07 S-03、S-04）を外さない。記事のタイトル、著者名、カテゴリ名、タグ名は HTML ではない文字列として、テキストと属性値にだけ使う（監査 2026-11-05-build2-review.md の申し送り）。
  3. 値から URL を作らない。外部へのリンクは `https://takatsu-connect.com/` で始まることを描く前に確かめる（06 §7）。
  4. CSP に `object-src 'none'` を足す。ほかの値（`default-src 'self'`、`connect-src 'self'`、`img-src 'self' data:`、`form-action 'none'`、`base-uri 'self'`、`frame-ancestors 'none'`、`style-src 'self'`）は変えない。
  5. E2E（E-01）で、全画面で CSP 違反が 0 件であること、インラインの script が Next.js の出すものだけであること（`self.__next_f` と チャンクの登録以外の中身がないこと）を確かめる。
- 見直す条件: ログインや、ブラウザに渡る秘密を足すとき（そのときは案 A のままにしない）。Next.js が静的生成のインライン script をハッシュで許す仕組みを正式に持ったとき。HTML として値を描く必要が出たとき。

## 結果

- 良い点: 静的生成と `headers()` の構成を変えずに済む。壊れ方が増えない。
- 引き受ける点: 値を HTML として描く不具合を作り込んだとき、CSP はインラインの script を止めない。入口の lint と E2E に頼る。06 §6 の表の `script-src` は `'self' 'unsafe-inline'` に、07 の E-01 と S-11 の期待値も同じに直す。
- `.claude/rules/security.md` の「応答ヘッダを設定する: Content-Security-Policy」は満たす。`script-src` の値は規則に書かれていないが、目標（06 §6 の `'self'`）から下げる判断なので、この ADR に記録し、security-auditor の確認を受ける。
