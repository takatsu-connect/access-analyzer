# ADR 0010: CSP の `script-src`（静的生成のインラインスクリプト）

- 状態: 確定（2026-11-07。security-auditor は条件つきで認め、依頼者が確認 1〜4 に回答した）
- 更新日: 2026-11-07
- 関係: NFR-91、06_security.md §6・§13（D-17）、ADR 0006（静的生成）、ADR 0008「結果」（`style-src` は確定、`script-src` は実装時に決める）、07_test_plan.md E-01・S-11
- 監査: docs/security/audits/2026-11-05-csp-script-src.md（条件つきで認める。致命的 0、高 1、中 4、低 4）
- 変更履歴:
  - 2026-11-05: 新規
  - 2026-11-05: 監査の指摘を反映。残る害の記述と比較表を直し（M-1）、かわりに守ることに 6〜8 を足し（H-1、M-3、M-4）、見直す条件に置き場所などを足した（M-2）。選ばなかった案に `'strict-dynamic'` を足した（L-1）
  - 2026-11-06: 構築 3 の監査（audits/2026-11-05-build3-review.md）の M-1、M-2 を反映。2 に URL のクエリ由来の値を、6 に lint の抜け道（スプレッド、`createElement`、`cloneElement`、`setAttribute`、移動の出口）を足し、見直す条件の「入力する欄」を絞って S-02e の検索欄を名指しした。5 と 8 の E2E の結果を記録した
  - 2026-11-07: 依頼者の回答（下の「依頼者に確認すること」）を記録し、確定にした。06 §6・§7・§13、07 E-01 を同じコミットで直し、ADR 0008「結果」に追記した
- 事実の出典:
  - 実機の検証（2026-11-05、構築 3）。Next.js 16.4.5（App Router、Turbopack）で `next build` → `next start` し、Playwright の Chromium で仮の 1 画面を開いた。検証のスクリプトは `apps/web/e2e/csp.spec.ts`
  - Next.js 公式文書 v16.2.9 `docs/01-app/02-guides/content-security-policy.mdx`（context7 で 2026-11-05 に確認。実機の版とは違う）
  - CSP の各指示が何を止めるかの記述は、仕様の理解に基づく。実機では確かめていない

## 文脈

- BI は全ページを静的生成し、実行時のサーバー処理を持たない（ADR 0006）。応答ヘッダは `next.config` の `headers()` で全パスに同じ値を付ける（06 §6）。
- 06 §6 の CSP は `script-src 'self'` を目標にしていたが、App Router の静的生成は HTML にインラインの `<script>` を出すので、成り立つかを実装時に確かめることにしていた（D-17）。構築 2 の監査の申し送りは「D-17 は inline を許さない形で決める」だった。この ADR は、その申し送りから外れる判断を記録する。
- この BI にはログインがなく、ブラウザに渡る秘密（Cookie、トークン、キー）もない。載っているのは公開ビューの値と、WordPress 由来の記事タイトル、著者の表示名、カテゴリ名、タグ名である。
- スクリプトを差し込まれたときの害は、秘密や個人のデータの持ち出しではなく、次のものである。
  - ページの書き換え（特定のライターや記事の数字を変える、文言を変える、ページ全体を別の内容にする）
  - 訪問者を別のサイトへ送ること（`location` の書き換え、リンクの差し替え）。URL に値を載せれば、外部への送信にもなる
  - 偽の入力欄を出して、訪問者に何かを入力させること
- 差し込みの入口になりうるのは、値を HTML として描いてしまう不具合である。値を書けるのは、WordPress で題名、表示名、カテゴリ名、タグ名を編集できる人。URL のクエリを DOM に書く誤りを作れば、細工したリンクを踏ませるだけの第三者も入口になる。

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

確かめていないこと: ハッシュを並べた CSP の実機での動作、動的なパス（記事や著者のページ）と 404 でのインライン script の数と形、Vercel 上でのヘッダの付き方、`script-src-attr 'none'` のもとでの動作（下の「かわりに守ること」の 8 で確かめる）。

## 選択肢

| 案 | 内容 | 成り立つか |
| --- | --- | --- |
| A | `script-src 'self' 'unsafe-inline'` | 実機で成り立つ。公式の案内どおり |
| B | `script-src 'self'` + `experimental.sri` | 成り立たない（上の表） |
| C | ハッシュを並べる。ビルドのあとで全ページ（300〜350）の HTML からインライン script のハッシュを計算し、ページごとの CSP を配る | 未検証。配り方は (C1) HTML に `<meta http-equiv>` を差し込む、(C2) パスごとの応答ヘッダを生成する、の 2 通り |
| D | nonce | 毎リクエストのサーバー処理が要る。ADR 0006 と両立しない |
| E | Pages Router に変える（データは実行されない JSON として埋まる） | 未検証。設計（ADR 0004、0006、04、05）の作り直しになる |
| F | `'unsafe-inline'` + `'strict-dynamic'`（06 §6 と ADR 0008 が挙げていた案） | nonce もハッシュもないと `'self'` まで無効になり、成り立たない（仕様の理解。未検証） |

## 比較（A と C）

| 観点 | A: `'unsafe-inline'` | C: ハッシュ |
| --- | --- | --- |
| 差し込まれたスクリプトを止める力 | インラインの script は止まらない。止まるのは、外部のスクリプトの読み込み、`fetch` と画像とフォームによる外部への送信（`connect-src 'self'`、`img-src 'self' data:`、`form-action 'none'`）まで。ページの書き換え、遷移による誘導と送信、偽の入力欄は止まらない | 型に合うインライン script だけをハッシュすれば、差し込まれたものは止まる。全部をそのままハッシュすると、ビルド時に混入した script も許すことになる |
| 止めたい事故の入口 | 値を HTML として描いてしまう不具合。入口は lint で塞ぐ（下の「かわりに守ること」） | 同じ入口。塞ぎ漏れたときの二重の守りになる |
| 守るもの | 訪問者に見せる内容の正しさと、訪問者を誘導させないこと。秘密はブラウザにない | 同じ |
| 壊れ方 | 壊れにくい。Next.js の出力が変わっても動く | 計算のずれはビルド時の照合で見つけられる。配り方のずれ（未確認）は、一部のページだけ操作が効かなくなる形で現れ、無人の日次ビルドでは気づくのが遅れる |
| Next.js の更新への追従 | 不要 | インライン script の出し方が変わるたびに、計算のスクリプトを直す |
| 配り方の前提 | `headers()` のまま | (C1) ビルドの成果物を書き換える。Vercel がその成果物を配るかは未確認。(C2) Vercel のパスごとのヘッダの上限と、ビルドのあとで設定を作る方法が未確認 |
| 実装と保守 | lint と E2E と、ビルド後の検査 | それに加えて、ハッシュの計算と配布、失敗時の通知 |

## 決定

案 A を採る。`script-src 'self' 'unsafe-inline'`。

- 理由: ブラウザに秘密がなく、害の上限は表示の書き換えと誘導である。入口は静的検査と React の描き方で塞ぐ。案 C は二重の守りになるが、配り方が未確認で、無人の日次ビルドに気づきにくい壊れ方を持ち込むおそれがあり、運用の負荷（NFR-70）に見合わないと判断した。
- 案 A では、CSP がインラインの script を止めないので、静的検査が主な守りになる。かわりに次を守る。1〜8 が初回公開の条件である。
  1. アプリのコードはインラインの script を足さない。JSX の `<script>`（JSON-LD を含む）、`next/script`、`iframe`、`object`、`embed`、`base` を lint で禁止する。
  2. `dangerouslySetInnerHTML`、`style` prop、JSX のリテラル文言の禁止（07 S-03、S-04）を外さない。記事のタイトル、著者名、カテゴリ名、タグ名、参照元ドメインと、URL のクエリ由来の値（S-02e の検索語 `q`。匿名の第三者がリンク 1 本で持ち込める唯一の文字列）は、HTML ではない文字列として、テキストと属性値にだけ使う。
  3. 値から URL を作らない。外部へのリンクは `https://takatsu-connect.com/` で始まることを描く前に確かめる（06 §7）。`javascript:` の URL を lint で禁止する。
  4. CSP に `object-src 'none'` を足す。ほかの値（`default-src 'self'`、`connect-src 'self'`、`img-src 'self' data:`、`form-action 'none'`、`base-uri 'self'`、`frame-ancestors 'none'`、`style-src 'self'`）は変えない。`'unsafe-inline'` が現れるのは `script-src` の 1 か所だけにし、`'unsafe-eval'`、`data:`、`blob:`、`https:`、`*` を `script-src` に入れない。
  5. E2E（E-01）で、画面の種類ごとに、CSP の指示の集合が期待値と完全に一致すること、CSP 違反が 0 件であること、インラインの script が Next.js の出す形（チャンクの登録と `self.__next_f`）だけであること、`on*` の属性と `javascript:` の URL がないことを確かめる。HTML として解釈されうる文字列（`<img src=x onerror=…>` と、そのエンティティの形）を題名や名前に持つフィクスチャを入れ、文字として描かれることを確かめる。
  6. JSX の外の出口を lint で禁止する: `innerHTML`、`outerHTML`、`insertAdjacentHTML`、`srcdoc`、`setHTMLUnsafe`、`createContextualFragment`、`document.write`、`document.writeln`、`eval`、`new Function`、文字列を渡す `setTimeout`。あわせて、規則を素通りする書き方を禁止する（2026-11-06）: DOM 要素への props のスプレッド、オブジェクトに書いた `dangerouslySetInnerHTML`、`createElement` と `cloneElement`（import も）、`setAttribute` の全般、`location.assign`、`location.replace`、`window.open`、`href` への代入。規則ごとに「落ちるべき書き方」を `apps/web/tests/lint/eslint-config.test.ts` で確かめる。
  7. lint の無効化コメント（`eslint-disable`）を使えなくする（`noInlineConfig`）。lint、E2E、下の 8 のビルド後の検査を、CI の必須チェックにする（デプロイ工程）。ビルド後の検査は日次の本番ビルドでも走らせ、失敗したらビルドを失敗させる（前日の版が残る）。
  8. `script-src-attr 'none'`（イベントハンドラの属性の実行を止める指示）を実機で試し、成り立てば足す。成り立たなければ、その結果をこの ADR に記録する。途中経過（2026-11-05）: 仮の 1 画面では、`script-src-attr 'none'` と `object-src 'none'` を足しても CSP 違反は 0 件で、操作も効いた。`next.config.ts` に入れてある。全種類の画面での確認は E2E（上の 5）で行う。結果（2026-11-06）: 全 21 画面で CSP 違反 0 件、onclick 属性のハンドラが動かず違反が出ることを Chromium で確認した。WebKit だけ、期間の選択（select）で `style-src-attr` の違反が 1 件出る（操作は効く。原因と実機の Safari で出るかは未確認。E2E は fixme）。
- 見直す条件（どれかに当たれば、案 A のままにしない）:
  - ログイン、Cookie、ブラウザに渡る秘密を足すとき。
  - BI を、ログインのあるサイトと同じ登録ドメインに置くとき（例: `takatsu-connect.com` のサブドメイン。WordPress と同じサイトの扱いになり、「ブラウザに秘密がない」の前提が崩れる）。
  - 秘密や個人情報を入力させる欄、または入力をサーバーや外部へ送る欄を足すとき。第三者のスクリプト（解析、広告、Vercel の Web Analytics や Speed Insights、Toolbar など）を足すとき。`'unsafe-inline'` のもとでは、HTML に足された script は CSP 違反にならない。
    - S-02e の検索欄（記事の題名の部分一致）は当たらない。入力は送られず（`form-action 'none'`、`connect-src 'self'`、問い合わせに使わない）、秘密でもなく、検証（NFC、1〜50 文字）のあと React の値と `URLSearchParams` にだけ使う。HTML の形の検索語が入力欄の値のままで要素にならないことを E2E で確かめる（`apps/web/e2e/inline-script.spec.ts`）。検索語を見出しや文に差し込む変更は、上の 2 に従う。
  - HTML として値を描く必要が出たとき。
  - Next.js の更新で、インライン script の形が変わったとき（上の 5 と 8 の検査が落ちる）と、静的生成のインライン script をハッシュで許す仕組みが正式に入ったとき。

## 結果

- 良い点: 静的生成と `headers()` の構成を変えずに済む。壊れ方が増えない。
- 引き受ける点: 値を HTML として描く不具合を作り込んだとき、CSP はインラインの script を止めない。残る害は、表示の書き換え、誘導、偽の入力欄である。静的検査と E2E に頼る。
- 06 §6 の表の `script-src`、06 §7（値を文字列として描く規則）、06 §13 の D-17、07 の E-01 と S-11 は、この ADR の確定と同じコミットで直す。ADR 0008 は書き換えず、追記にする。
- `.claude/rules/security.md` の「応答ヘッダを設定する: Content-Security-Policy」は満たす。規則の書き換えは要らない。

## 依頼者に確認したこと（2026-11-07 に回答）

1. BI の公開ドメイン: **Vercel の既定のドメイン（`*.vercel.app`）**。`takatsu-connect.com` と別の登録ドメインなので、案 A の前提を満たす。あとで独自のドメインに移すときも、`takatsu-connect.com` のサブドメインでなければ案 A のまま。
2. 残る害（表示の書き換え、誘導、偽の入力欄）を承知のうえで、**案 A を引き受ける**。
3. WordPress で題名、表示名、カテゴリ名、タグ名を編集できるのは、**運営 3 人とライター約 20 人**。依頼者は回答の時点で、**管理者に 2 要素認証を必須にした**（ライターは未設定）。ライターのアカウントから入る文字列も、上の 2、5 のとおり文字として描く。
4. Vercel の **Web Analytics、Speed Insights、Toolbar を本番で使わない**。有効にするときは、見直す条件に当たる。
