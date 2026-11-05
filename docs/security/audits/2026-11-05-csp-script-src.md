# セキュリティ監査: ADR 0010（CSP の `script-src`）

- 状態: 草案（依頼者の確認の前）
- 更新日: 2026-11-05
- 監査者: security-auditor
- 対象: docs/design/adr/0010-csp-script-src.md（状態: レビュー中、コミット 4668546）

## 1. 範囲と読んだファイル

範囲は、ADR 0010 の提案（`script-src 'self' 'unsafe-inline'`）の可否と、それを支える歯止めの過不足。観点 5（Vercel と BI アプリ）の応答ヘッダが中心。コード、設定、ADR は変更していない。

読んだファイル（依頼で指定された範囲だけ）:

- docs/design/adr/0010-csp-script-src.md（全体）
- docs/design/06_security.md 109〜131 行、194〜204 行（§13）
- docs/design/adr/0008-chart-and-ui-library.md 42〜58 行
- apps/web/next.config.ts、apps/web/eslint.config.mjs、apps/web/e2e/csp.spec.ts（全体）
- docs/security/audits/2026-11-05-build2-review.md 114〜123 行（構築 3 への申し送り）

読み取りコマンドで確かめたこと（2026-11-05）:

- `git grep`（apps/web/src、apps/web/eslint-rules）: `eslint-disable`、`dangerouslySetInnerHTML`、`innerHTML`、`outerHTML`、`insertAdjacentHTML`、`document.write`、`next/script`、`<script`、`srcdoc`、`javascript:` の一致は 0 件。
- `git ls-files`: `.github/` に追跡されたファイルはない。apps/web/eslint-rules/ は index.mjs と pub-from-only.mjs だけ。apps/web/scripts/ は check-forbidden-words.mjs と check-public-env-names.mjs。
- apps/web/package.json: `build` は `next build` だけ、`lint` は `eslint . --max-warnings 0`、`e2e` は `playwright test`。

読んでいないもの: 07_test_plan.md（E-01、S-11 の現在の文言）、ADR 0006、docs/operations/、apps/web/src の中身。外部の文書は取っていない。CSP の仕様に関する記述は監査者の知識によるもので、事実票も実機の確認もない（§6 に分けて書いた）。

## 2. 結論

**判断: 条件つきで認める。** 設計を進めてよいが、ADR 0010 を「確定」にする前に下の条件 1〜3 を ADR に書き足し、初回公開の前に条件 4〜6 を実装する。

認める理由（確認済みの前提から）:

- 全ページが静的で、ログインも Cookie もなく、載る値はすべて公開ビューのもの。差し込まれたスクリプトが持ち出せる秘密はこの BI のオリジンにはない（ただし置き場所に依存する。M-2）。
- `'self'` と `experimental.sri` では画面の操作が効かないことを実機で確かめている。nonce は ADR 0006 と両立しない。
- 値を HTML として描く経路は、現時点のコードに 1 つもない（`git grep` で 0 件）。

条件:

1. ADR の「かわりに守ること」に、JSX の外の出口の禁止と、lint の無効化の禁止を足す（H-1）。
2. ADR の害の記述と比較表を直す。遷移による送信と誘導は止まらないこと、偽の入力欄や数字の書き換えが残ることを書き、依頼者がそれを承知で引き受ける（M-1）。
3. 見直す条件に、置き場所（同じ site にログインのあるサイトがあるドメイン）、入力欄、第三者のスクリプトを足す（M-2）。
4. 公開前に、lint の規則を実装し、lint・E2E・ビルド後の HTML の検査が自動で走る場所を作る（H-1、M-4）。
5. 公開前に、`script-src-attr 'none'` を実機で試し、成り立てば足す。成り立たなければ結果を ADR に記録する（M-3）。
6. 公開前に、`object-src 'none'` を足す（L-2）。

件数: 致命的 0、高 1、中 4、低 4。

認めない場合に要ること（参考）: 案 C を実機で成り立たせる（§4.4 の順に確かめる）か、案 E（Pages Router）で設計を作り直す。どちらも、この BI の害の上限（内容の書き換えと誘導）に対しては費用が見合わないと監査者は考える。

## 3. 指摘（重要度順）

### 高

#### H-1 案 A では静的検査が唯一の防壁になるが、その検査に穴があり、ADR の 5 点にも入っていない

- 対象: docs/design/adr/0010-csp-script-src.md:63-68、apps/web/eslint.config.mjs:26-52、`.github/`（ファイルなし）
- 問題（確認済み）:
  - 構築 2 の監査の申し送り 2（`innerHTML`、`outerHTML`、`insertAdjacentHTML`、`document.write`、`<script>` への埋め込みを静的検査に足す）が、eslint.config.mjs にも ADR の 5 点にもない。ADR:65 が引くのは申し送り 1 だけ。
  - 申し送り 7 は「D-17 は inline を許さない形で決める。1〜2 が破れたときの 2 枚目になる」だった。案 A はこの 2 枚目を外す。ADR はそのことに触れていない。
  - eslint.config.mjs に `<script>` と `next/script` の禁止がない（ADR:64 の未実装）。
  - `eslint-disable` のコメントを禁じる設定（`noInlineConfig` など）がない。ADR:65 の「外さない」を守らせる仕組みがない。
  - `.github/` に追跡されたファイルがなく、lint と E2E が自動で走る場所がまだない。
- 悪用の筋道: 開発者（またはエージェント）が Client Component で `ref.current.innerHTML = title` と書く、または `// eslint-disable-next-line react/no-danger` を付ける。lint は通る。WordPress で記事タイトル、表示名、カテゴリ名、タグ名を書ける人（ライター、乗っ取られたアカウント）が `<img src=x onerror=…>` を入れる。バッチは HTML エンティティを戻すので、`&lt;img …&gt;` の形でも生の文字列として格納される（build2-review.md:93）。次の日次ビルドで全訪問者のブラウザでスクリプトが動く。URL のクエリを DOM に書く誤りなら、WordPress に書けない第三者でも、細工したリンクを踏ませるだけで同じことができる。
- 影響: 表示の書き換え、外部への誘導、偽の入力欄（M-1）。`script-src 'self'` なら CSP が止めていた。案 A では止まらない。
- 対策: §4.5 の lint の案を実装し、ADR の「かわりに守ること」に 6（JSX の外の出口の禁止）と 7（lint の無効化コメントの禁止、lint と E2E を main への必須チェックにする）を足す。申し送り 7 から外れることと、その埋め合わせ（M-3、M-4）を ADR に明記する。
- 根拠: 上記ファイルの該当行、`git grep`、`git ls-files`。現時点で違反するコードはない（0 件）。穴があるのは検査の側。
- 関係: NFR-91、07 S-03・S-04、build2-review.md 申し送り 1・2・7

### 中

#### M-1 害の見積もりが狭く、「外部への送信は止まる」が言い過ぎ

- 対象: 0010:14、0010:50
- 問題: ADR は害を「内容の書き換え」と「別のサイトへ送ること」の 2 つとし、比較表で「外部への送信（`connect-src`、`img-src`、`form-action`）は止まる」と書く。次が抜けている（CSP の仕様についての監査者の知識。実機は未確認）。
  - 遷移は CSP で止められない。`location.href = 'https://…/?d=' + 値`、`window.open`、リンクの `href` の差し替え、`<meta http-equiv="refresh">`。遷移の URL に載せれば送信もできる。遷移を縛る指示（`navigate-to`）は主要なブラウザにない。
  - `connect-src` が縛らない経路がほかにもありうる（WebRTC、`dns-prefetch`）。未確認。
  - 偽の入力欄。BI のドメインの上に「ログインしてください」の画面を描き、入力を遷移で送る。`form-action 'none'` はスクリプトによる遷移を止めない。
  - 数字の書き換え。特定のライターの記事の数字を偽る。この BI は「ライターを競わせない」を前提にしており、評判への害は軽くない。
  - 訪問者のブラウザの計算資源の利用、閲覧環境の情報の収集。
- 各指示が実際に抑える範囲（同上、未確認）:

| 指示 | 抑えるもの | 抑えないもの |
| --- | --- | --- |
| `script-src 'self'`（`'unsafe-inline'` つき） | 外部の script の読み込み、`eval`（`'unsafe-eval'` がないため） | インラインの script、イベントハンドラ属性、`javascript:` の URL。差し込む本体を長くすれば外部の読み込みは要らない |
| `connect-src 'self'` | `fetch`、XHR、WebSocket、`sendBeacon` | 遷移による送信 |
| `img-src 'self' data:` | 画像の要求に載せた送信 | 同上 |
| `form-action 'none'` | フォームの送信 | スクリプトによる遷移、見た目だけの偽の入力欄 |
| `base-uri 'self'` | `<base>` を外部に向けること | スクリプトが動くなら `<base>` は要らない |
| `frame-ancestors 'none'` | ほかのサイトへの埋め込み | 差し込みとは無関係 |
| `default-src 'self'` | 外部の frame、font、media、worker、object | 同じオリジンのもの。`srcdoc` や `javascript:` の frame（未確認） |

- 影響: 依頼者が、実際より小さい害を前提に引き受けることになる。
- 対策: 0010:14 と 0010:50 を上の内容で書き直す。「秘密の持ち出しはないが、遷移による誘導と送信、偽の入力欄、数字の書き換えは CSP では止まらない」と書く。
- 関係: NFR-91

#### M-2 「ブラウザに秘密がない」は置き場所に依存する。見直す条件が足りない

- 対象: 0010:14、0010:69
- 問題: 前提はオリジンだけでなく site（登録できるドメイン）にも依存する。BI を `takatsu-connect.com` のサブドメインに置くと、BI で動くスクリプトは WordPress と同じ site になり、親ドメインに向けた Cookie の読み書きや、SameSite の保護の外からの要求ができる（一般的な知識。この構成での実機は未確認）。公開ドメインは、読んだ範囲に書かれていない。
- 対策: 見直す条件に次を足す。
  - BI を、ログインのあるサイトと同じ登録ドメインの下に置くとき（`*.takatsu-connect.com` など）。
  - 入力欄（検索、問い合わせ、コメント）を足すとき。
  - 第三者のスクリプト（解析タグ、埋め込み）を足すとき。`'unsafe-inline'` のもとでは、足しても CSP 違反にならず気づけない。
  - Next.js を更新したとき（E-01 のインライン script の形の検査をやり直す）。
  - `style-src` は `'self'` のまま。`script-src` を緩めたことを `style-src` を緩める理由にしない。
- 関係: NFR-91、§5 の確認項目 1

#### M-3 `script-src-attr 'none'` が検討されていない

- 対象: 0010:38-44、0010:67、apps/web/next.config.ts:9-19
- 問題: 案 A と 案 C の間に、費用のほとんどかからない中間がある。`script-src 'self' 'unsafe-inline'; script-src-attr 'none'` は、Next.js が出す `<script>` 要素を許したまま、イベントハンドラ属性（`onerror=`、`onload=`、`onclick=`）の実行を止める（CSP Level 3 の仕様についての監査者の知識）。値を HTML として描く誤りで最もよく使われるのがこの形で、`innerHTML` で入れた `<script>` 要素はもともと実行されないので、DOM 経由の差し込みの大半がここで止まる。対応していないブラウザは `script-src` に戻るだけで、壊れない。
- 限界: `javascript:` の URL と `<iframe srcdoc>` は止まらない見込み。差し込みを狭めるが、閉じない。
- 未確認: Next.js 16.4.5 と React の静的な出力がイベントハンドラ属性を出さないこと（ADR の表は script と style しか数えていない）。各ブラウザの対応状況。
- 対策: csp.spec.ts と同じ方法で、(d) `'self' 'unsafe-inline'` + `script-src-attr 'none'` を全種類の画面で試す。違反 0 件で操作が効けば採り、ADR の「確かめた事実」に列を足す。成り立たなければ、その結果を書く。
- 関係: NFR-91、build2-review.md 申し送り 7

#### M-4 歯止め 5（E-01）が未完成で、見る範囲も足りない

- 対象: 0010:68、apps/web/e2e/csp.spec.ts:16-17、:33-42、:70-82、:156-158
- 問題（確認済み）:
  - `script-src` の値を検査していない（:16-17 のとおり決定待ち）。ほかの指示は `toContain` なので、指示が足されたり値が増えたりしても通る（`'unsafe-eval'` や外部のホストが足されても気づかない）。
  - 開くのは `/` だけ。インライン script は数えるだけで、中身も数も検査していない。`scriptTags()` は開始タグしか取らない。
  - 歯止め 5 は `<script>` の中身だけを見る。`'unsafe-inline'` が新たに許すイベントハンドラ属性と `javascript:` の URL を見ない。
  - 敵対的な文字列（`<script>`、`"><img onerror=…>`、`</script>`）を含むフィクスチャで、文字として描かれることを確かめる試験がない。
  - `build` は `next build` だけで、日次の本番ビルドの出力は何も検査されない。E2E がフィクスチャで通っても、本番のデータで混入した script は見つからない。
- 対策:
  - E-01: CSP の指示の集合を完全一致で比べる。期待値は試験の中に独立に書き、next.config.ts の定数を import しない。
  - E-01: 画面の種類ごと（トップ、記事、著者、カテゴリ、404）に、配信された HTML のインライン script を全文で型に当てる。型は 3 つ（チャンクの登録、`(self.__next_f=self.__next_f||[]).push([0])`、`self.__next_f.push([1,"<1 つの文字列リテラル>"])` で、後ろに文が続かないこと）。知らない形は失敗にする。
  - E-01: HTML に `on` で始まる属性がないこと、`href`・`src`・`action`・`formaction`・`xlink:href` に `javascript:` がないこと。
  - フィクスチャに敵対的な題名、表示名、カテゴリ名、タグ名を足し、全画面で `window` に目印が立たないことと、文字のまま見えることを確かめる。エンティティの形（`&lt;img …&gt;`）も入れる。
  - ビルド後の検査を apps/web/scripts/ に足し（既存の check-*.mjs と同じ置き方）、`build` の後段で全ページの HTML に同じ 3 点（インライン script の型、`on*` 属性、`javascript:`）を当てる。失敗すればデプロイされず、前日の版が残る。一部のページだけ静かに壊れる形にはならない。
- 関係: NFR-91、07 E-01・S-11

### 低

#### L-1 選択肢と比較の書き落とし

- 対象: 0010:38-56
- 案 C の「インラインも止まる」は条件つき。ビルドのあとで全ページのインライン script をハッシュするなら、ビルド時に混入した `<script>` もハッシュされて許可される（ADR:42 の書き方からの推論。未検証）。型に合うものだけをハッシュする必要がある。案 C が確実に止めるのは、イベントハンドラ属性、`javascript:` の URL、実行時の DOM への差し込み。このうち最初のものは M-3 で得られる。
- 06 §6（:115）、§13（:197）、ADR 0008:58 は、選択肢を「hash の列挙」か「`'unsafe-inline'` + `'strict-dynamic'`」としていた。ADR 0010 の選択肢に後者がない。`'strict-dynamic'` は nonce かハッシュがないと何も読み込めなくなるので成り立たない（監査者の知識。未確認）。採らない理由を 1 行書く。
- 申し送り 7 から外れることを「文脈」に書く（H-1）。

#### L-2 `object-src 'none'` が未反映。足せる指示がほかにもある

- 対象: apps/web/next.config.ts:9-19、apps/web/e2e/csp.spec.ts:33-42
- `object-src` は `default-src 'self'` に戻るので、いまは同じオリジンの object が許される。利用者がファイルを置く経路はなく、害は小さい。ADR:67 のとおり足す。
- 併せて検討: `base-uri 'none'`（`<base>` を使っていなければ）、`frame-src 'none'`（frame を使っていなければ）。どちらも実機は未確認。

#### L-3 検証の範囲と出典

- 対象: 0010:7-8、0010:18、0010:34
- 実機の検証は仮の 1 画面。ADR も書いているとおり、動的なパス、データの多いページ、404 でのインライン script の数と形は未確認。RSC のデータが複数の `push` に分かれる、Suspense でほかの形の script が出る、といったことがあれば、歯止め 5 の型が変わる。画面が揃った時点で表を取り直す。
- 出典の公式文書は v16.2.9、実機は 16.4.5。版の差を注記する。監査では文書の文言を確かめていない。

#### L-4 開発モードの扱いと、仮の値

- 対象: docs/design/adr/0008-chart-and-ui-library.md:51、apps/web/next.config.ts:35-37、:3-6
- ADR 0008:51 は「開発モードはこの CSP を適用しない」と書くが、next.config.ts は環境で分けていない（確認済み）。開発で困ったときに、1 つしかない定数へ `'unsafe-eval'` を足す誤りが起きやすい。分けるなら本番の値を別の定数にし、E-01 の完全一致で守る。
- `'unsafe-inline'` は仮の値としてすでに main にある（コミット 8088928、コメントで明記）。公開前なので露出はない。ADR の確定を公開の関門に入れる。

## 4. 見てほしいことへの回答

### 4.1 案 A を認めてよいか

条件つきで認める（§2）。害の上限は「見せる内容の書き換え、誘導、偽の入力欄」で、秘密と個人のデータの持ち出しではない。差し込みの入口は、(1) WordPress 由来の文字列を HTML として描く誤り、(2) URL のクエリを DOM に書く誤り、の 2 つ。(1) は WordPress に書ける人が前提で、その人は本体のサイトにも同じことができる。(2) は第三者にもできるので、H-1 の lint と 06 §7 の許可リストが要になる。

### 4.2 「確かめた事実」と「比較」の誤りと書き落とし

- 「確かめた事実」の表と 3 本の script の説明に、読んだ範囲と食い違う点はない。csp.spec.ts の記録項目とも合っている。
- 誤りに近いのは 0010:50 の「外部への送信は止まる」（M-1）と、案 C の「インラインも止まる」（L-1）。
- 書き落としは、置き場所への依存（M-2）、`script-src-attr`（M-3）、`'strict-dynamic'` 案の扱いと申し送り 7（L-1）。

### 4.3 「かわりに守ること」5 点で足りるか

足りない。足すもの:

- 6: JSX の外の出口（`innerHTML`、`outerHTML`、`insertAdjacentHTML`、`document.write`、`srcdoc`、`createElement('script')`、`eval` の類）を lint で禁止する（H-1）。
- 7: `eslint-disable` を使えなくする。lint、E2E、ビルド後の検査を自動で走らせ、main への必須チェックにする（H-1）。
- 8: `script-src-attr 'none'`（実機で成り立てば。M-3）。
- 5 の拡張: `on*` 属性、`javascript:`、敵対的なフィクスチャ、全種類の画面、ビルド後の全ページ（M-4）。
- 3 の具体化: 外部リンクは 1 つの部品（検証つき）だけが描く。生の `<a href={値}>` を lint で禁じる。`'unsafe-inline'` のもとでは `javascript:` の `href` が実行されうるので、この検証の重みが増す。
- Trusted Types（`require-trusted-types-for 'script'`）: 静的生成の Next.js で成り立つかは未確認。成り立てば実行時の DOM への差し込みを止められるが、ビルド時に HTML へ混入したものは止めない。試すなら `Content-Security-Policy-Report-Only` で違反を数えるところから。初回公開の条件にはしない。

### 4.4 案 C を採らない理由の妥当性と、将来移るときに先に確かめること

方向は妥当だが、根拠は未検証に寄っている。

- 「一部のページだけ操作が効かない」のうち、計算のずれはビルド時に全ページを照合すれば必ず見つかる。静かに壊れるのは配り方のずれ（配信された HTML が計算したものと違う、パスごとのヘッダが付かない）で、ADR 自身が未確認としている部分。
- 採らない理由としては、L-1（ビルド時の混入はハッシュでは止まらない）と M-3（得られる守りの一部は安く得られる）を足すほうが強い。
- 将来移るときに先に確かめる順:
  1. 全種類の画面で、インライン script の数と形（L-3）。
  2. ハッシュするのは型に合う script だけにし、知らない形はビルドを失敗させる。
  3. 配り方。`<meta>` なら、どの script よりも前に置けるか。応答ヘッダの CSP と両方を満たす必要がある（ヘッダ側の `'unsafe-inline'` は残り、`<meta>` 側が絞る）。パスごとのヘッダなら、Vercel の上限と生成の方法。
  4. Vercel が配る HTML が、ビルドの成果物とバイト単位で同じか。
  5. 404 とエラー画面のインライン script。任意のパスで同じ中身か。
  6. 画面の中の遷移（クライアント側の遷移）がインライン script を使わないこと。
  7. 壊れたことを知る方法。本番への確認は「能動的な試験をしない」の規則に触れないやり方（プレビューでの確認など）を先に決める。

### 4.5 next.config.ts と eslint.config.mjs への反映の案

確認済みの未反映: `<script>` と `next/script` の禁止がない（eslint.config.mjs:26-52）。`object-src 'none'` がない（next.config.ts:9-19、csp.spec.ts:33-42）。

next.config.ts（`script-src-attr` は M-3 の確認のあと）:

```ts
"script-src 'self' 'unsafe-inline'",
"script-src-attr 'none'",
"object-src 'none'",
```

eslint.config.mjs の案。規則名は監査者の記憶によるもので、走らせていない。実装時に、違反の見本が error になることを確かめる。

```js
// ADR 0010: アプリのコードは script を足さない。
'react/forbid-elements': ['error', { forbid: [
  { element: 'script', message: 'script 要素は足しません（ADR 0010）。JSON-LD も同じです。' },
  'iframe', 'object', 'embed', 'base',
] }],
'no-restricted-imports': ['error', { paths: [
  { name: 'next/script', message: 'next/script は使いません（ADR 0010）。' },
] }],
// JSX の外の出口（監査 2026-11-05-build2-review.md 申し送り 2）。
'no-restricted-properties': ['error',
  { property: 'innerHTML' }, { property: 'outerHTML' },
  { property: 'insertAdjacentHTML' }, { property: 'srcdoc' },
  { property: 'setHTMLUnsafe' }, { property: 'createContextualFragment' },
  { object: 'document', property: 'write' }, { object: 'document', property: 'writeln' },
],
'no-eval': 'error', 'no-implied-eval': 'error', 'no-new-func': 'error',
'no-script-url': 'error', 'react/jsx-no-script-url': 'error',
```

- 既存の `no-restricted-syntax`（:28-42）は 1 つの配列なので、足す選択子は同じ配列に入れる。別に書くと前の定義が置き換わり、S-01 が外れる。足す選択子: `CallExpression[callee.property.name='createElement'][arguments.0.value='script']`、`ImportExpression[source.value='next/script']`、`CallExpression[callee.property.name='setAttribute'][arguments.0.value=/^on/i]`。
- 設定の先頭に `linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'error' }` を足す。いま `eslint-disable` は 0 件なので、足しても壊れない。
- lint の規則が効いていることを、違反の見本のファイルで試験する（規則を消すと試験が落ちる形）。

### 4.6 06 §6、07 の E-01・S-11 の書き換えで気を付けること

07 は読んでいないので、E-01 と S-11 の現在の文言は未確認。

- 06 §6 の表: CSP の値は、next.config.ts の定数と E-01 の期待値と 3 か所で同じにする。備考の「未確定」と「`'unsafe-inline'` + `'strict-dynamic'`」の記述を消し、ADR 0010 を指す。`'unsafe-inline'` は `script-src` だけで、`style-src` は `'self'` のままであることを同じ欄に書く。
- 06 §6 に「CSP はインラインの script を止めない。守りは §7 の規則、lint、E-01、ビルド後の検査」と、残る害を書く。
- 06 §7: 「BI は値を文字列として描く」（申し送り 8）と、JSX の外の出口の禁止を規則として書く。
- 06 §13: D-17 を未確定から確定へ移す。ADR 0010 の確定と同じコミットにする。
- ADR 0008:58 は書き換えず、「ADR 0010 で決定」と追記する。
- E-01: 期待値を「`'self' 'unsafe-inline'` に直す」だけにしない。指示の集合の完全一致、画面の種類ごと、インライン script の型、`on*` 属性と `javascript:` がないこと（M-4）。
- S-11: 静的検査なら、「`'unsafe-inline'` が現れるのは `script-src` の 1 か所だけ」「`'unsafe-eval'`、`'wasm-unsafe-eval'`、`data:`、`blob:`、`https:`、`*` が `script-src` にない」の形にする。
- .claude/rules/security.md は `script-src` の値を定めていないので、規則の書き換えは要らない。

## 5. 依頼者に確認してもらう項目

1. BI の公開ドメイン。`*.vercel.app` のままか、`takatsu-connect.com` のサブドメインにするか。後者なら案 A は認められず、見直しが要る（M-2）。
2. 残る害（表示の書き換え、誘導、偽の入力欄。M-1）を承知のうえで、案 A を引き受けるか。
3. WordPress で記事タイトル、表示名、カテゴリ名、タグ名を書ける人の範囲と、そのアカウントの 2 要素認証。
4. Vercel の設定で、HTML にスクリプトを足す機能（Web Analytics、Speed Insights、Toolbar）を本番で有効にしていないこと。`'unsafe-inline'` のもとでは、足されても CSP 違反にならない。

## 6. 未確認

- `script-src-attr 'none'` のもとで Next.js 16.4.5 の静的な出力が動くか。確認方法: csp.spec.ts に (d) を足して全種類の画面で違反 0 件と操作を確かめる。
- CSP の仕様に関する記述のすべて（遷移を縛る指示がない、ハッシュや nonce があると `'unsafe-inline'` が無視される、`'strict-dynamic'` の挙動、`script-src-attr` の対象とブラウザの対応、WebRTC と `dns-prefetch`、`srcdoc` と `javascript:` の frame）。事実票がなく、実機でも試していない。確認方法: 仕様の事実票（確認日と出典つき）を親が用意するか、E2E に差し込みの見本を足して挙動を記録する。
- Trusted Types が静的生成の Next.js で成り立つか。
- React が `javascript:` の `href` を止めるか。
- `vercel.app` が Public Suffix List にあり、ほかの利用者のサイトと分離されるか。
- 動的なパス、データの多いページ、404 でのインライン script の数と形。Vercel 上でのヘッダの付き方（ADR も未確認としている）。
- 07 の E-01、S-11 の文言。日次のビルドがどこで動くか（ADR 0006）。docs/operations/ に、差し込みが見つかったときの手順（前のデプロイに戻す、原因の文字列を直す、ビルドをやり直す）があるか。
- Next.js 公式文書の文言。ADR の出典の記載を信頼した。
- eslint の規則名が、いまの依存の版で使えるか。

## 7. 問題なしと確認した項目

- apps/web/src と apps/web/eslint-rules に、HTML として値を描く出口、`<script>`、`next/script`、`eslint-disable` は 0 件（`git grep`）。
- CSP に `'unsafe-eval'` がなく、`script-src` に外部のホストがない。`style-src 'self'` は保たれている（next.config.ts:10-18）。
- CSP の値は 1 つの定数に書かれ、全パス（`/(.*)`）に付く。`poweredByHeader: false`（next.config.ts:9-19、:32、:36）。
- X-Content-Type-Options、Referrer-Policy、X-Frame-Options、X-Robots-Tag、Permissions-Policy が 06 §6 のとおり（next.config.ts:21-28）。404 でも同じヘッダを E2E が検査している（csp.spec.ts:174-190）。
- `react/no-danger`、`react/forbid-dom-props`（style）、`react/jsx-no-literals`、`no-console` は error で有効。lint は `--max-warnings 0`。
- ADR の検証の表は、csp.spec.ts が記録する項目（違反、クリック、インライン script の数、integrity、style）と対応している。

## 8. 規則（.claude/rules/security.md）への準拠

- 「応答ヘッダを設定する: Content-Security-Policy」は満たす。`script-src` の値は規則にない。設計の目標（06 §6 の `'self'`）から下げる判断を ADR に書き、監査を求めており、手順は規則どおり。
- 「外部へのリンク先は takatsu-connect.com に固定する」は ADR:66 と 06 §7（:129）にある。実装は未確認（apps/web/src を読んでいない）。
- 「確認の流れ」: 高の指摘 H-1 は Issue にし、ADR の確定と初回公開の前に直す。
