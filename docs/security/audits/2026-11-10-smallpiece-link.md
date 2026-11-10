# 監査: フッタの制作者（Small Piece）へのリンク（ADR 0012）

- 状態: 確定
- 更新日: 2026-11-10
- 監査の範囲: 未コミットの変更のうち、フッタの制作者リンクに関わるもの（ADR 0012、`safeExternalUrl` と `SMALLPIECE_URL`、`ExternalLink`、`SiteFooter`、U-26、E-16、.claude/rules/security.md の例外の文）。観点 5（Vercel と BI アプリ）の外部リンクと応答ヘッダ、規則への準拠。それ以外の未コミットの変更（`apps/batch/uv.lock`、`apps/web/AGENTS.md` ほか）は範囲外。

## 読んだファイル

- docs/design/adr/0012-smallpiece-footer-link.md（全体）
- apps/web/src/lib/derive/links.ts（全体）
- apps/web/src/components/ExternalLink.tsx（全体）
- apps/web/src/components/SiteFooter.tsx（全体）
- `git diff` の .claude/rules/security.md、apps/web/e2e/routes.spec.ts（E-16）、apps/web/tests/lib/derive.test.ts（U-26）、apps/web/src/lib/derive/index.ts、apps/web/src/lib/ui-text.ts
- .claude/rules/security.md「BI アプリ（Vercel）」の節、.claude/rules/smallpiece-link.md（セッションの規則として参照）
- `git grep` による確認: apps/web/next.config.ts:28（Referrer-Policy）、docs/design/06_security.md:28,119,132、docs/design/05_screens.md:231,234,743

## 結論

**公開してよい。** 致命的 0 件、高 0 件、中 0 件、低 3 件。

例外は、コードに固定した 1 つの URL との厳密な文字列一致（`===`）に限られており、似た URL、大文字小文字、エンコード、末尾の空白などの迂回で通る経路はない。リンク先は利用者の入力やデータに依らず、規則の目的は保たれている。低の指摘は文書とコメントの整合だけで、公開の前提にはしない。

## 指摘

### L-1（低）設計文書が「外部リンクは takatsu-connect.com 配下だけ」のまま

- 対象: docs/design/06_security.md:28、06_security.md:132（§7）、docs/design/05_screens.md:234（「外部リンクを置くのは 2 か所だけ」）
- 問題: 05 §2.7 の 231 行目には制作者のリンクが足されたが、同じ節の 234 行目と 06 の 28 行目・§7 は、外部リンクが高津コネクトの 2 か所だけである前提の記述のまま。ADR 0012 の「関係」に 06 §7 が挙がっているが、06 は未変更。
- 悪用の筋道: なし。将来の変更者が 06 §7 を根拠に例外を「設計外」と誤解して消す、または逆に 06 と規則の食い違いを根拠に例外を広げる、という文書の不整合による誤りの余地がある。
- 対策: 06 §7（と 28 行目）に「例外: フッタの制作者リンク。固定の 1 つの URL と完全一致のみ（ADR 0012）」を足す。05 の 234 行目を「高津コネクトへの外部リンクは 2 か所。ほかにフッタの制作者リンク（§2.7 上記、ADR 0012）」の形に直す。
- 根拠: `git grep` の結果（上記の行）。
- 関係する要件: FR-04

### L-2（低）`ExternalLink` のコメントが旧仕様のまま

- 対象: apps/web/src/components/ExternalLink.tsx:6、:15〜18
- 問題: props の `href` の説明が「pub_post.post_url / pub_author.author_url の値」、部品の説明が「外部（高津コネクト）へのリンク」「https://takatsu-connect.com/ の配下であることを確かめ直す」のままで、SMALLPIECE_URL の例外に触れていない。links.ts のコメントは更新済み。
- 悪用の筋道: なし（衛生面）。
- 対策: 「または ADR 0012 の SMALLPIECE_URL（完全一致）」を書き足す。
- 根拠: ファイルを読んで確認。

### L-3（低）例外が「フッタ」に限られることはコードではなく E2E が担保している

- 対象: apps/web/src/lib/derive/links.ts:21、apps/web/e2e/routes.spec.ts（E-16 の追加部分）
- 問題: `safeExternalUrl` は呼び出し元を問わず SMALLPIECE_URL を通すので、データ（`pub_post.post_url` など）がこの文字列と完全に一致すれば、フッタ以外にも同じリンクが描かれる。規則の文は「フッタの制作者（Small Piece）へのリンク」と場所まで書いている。
- 悪用の筋道: バッチは記事・著者の URL を takatsu-connect.com 配下に検証して格納する（06 §7）ため、データからこの値が入る経路は実質ない。入ったとしても行き先は同じ固定の URL で、害はない。E-16 が各ページで `a[href^="https://smallpiece.jp"]` が 1 つだけであることを確かめているので、増えれば検出される。
- 対策: 現状のままで可（受容を推奨）。規則の文と一致させたいなら、ADR 0012 の「理由」に「場所の限定は E-16 で確かめる」と一文足す。
- 根拠: links.ts と E-16 の差分を読んで確認。

## 確認した観点と結果（問題なし）

1. **例外が完全一致の 1 件に限られているか**: links.ts:21 は `url === SMALLPIECE_URL` の厳密比較で、前方一致・ドメイン一致・正規化を経ない。一致しない値は従来の takatsu-connect.com の検査（前方一致 + `new URL` のオリジン、userinfo の拒否）に落ち、smallpiece.jp は `ALLOWED_PREFIX` に合わず null になる。定数は links.ts:12〜13 の 1 か所だけ。
2. **迂回の経路**:
   - 似た URL（別パス、`http:`、余分なパラメータ、`smallpiece.jp.example.com`）: 文字列が異なるので null。U-26 に 5 例あり。
   - 大文字小文字（`HTTPS://SmallPiece.jp/...`）、パーセントエンコード（`%2E`、`%26` など）、IDN・同形異字、末尾の空白や `#` の付加、パラメータの順序の入れ替え: いずれも文字列が異なるので null。厳密比較なので、URL の解釈の違いを突く余地がない。U-26 にこれらの例は無いが、比較の形から結論は変わらない（足すなら大文字の 1 例で十分）。
   - `javascript:` などのスキーム: 一致せず、前方一致にも合わないので null。
   - 型: 非文字列は `===` で一致せず、2 行目の `typeof` で null。
3. **rel と target**: `ExternalLink` は `target="_blank" rel="noopener"`。開いた先から `window.opener` を触れない（reverse tabnabbing の防止）。E-16 の既存の検査（target="_blank" のリンクに noopener があること）がフッタのリンクにも及ぶ。`noreferrer` は付けていないので Referer は送られるが、次項のとおり origin だけ。
4. **Referrer-Policy で渡るもの**: apps/web/next.config.ts:28 で `strict-origin-when-cross-origin`。https → https の別オリジンへの遷移なので、Small Piece に渡るのは BI の origin（`https://takatsu-connect-analyzer.vercel.app/`）だけで、パス（記事 ID、著者 slug、期間）やクエリは渡らない。UTM の値は固定で、訪問者や BI のデータを含まない。BI 側に外部の読み込みや計測は増えず、CSP は変わらない。プライバシー上の追加の露出はない。
5. **smallpiece-link.md への準拠**: `utm_source=takatsu-connect-analyzer`、`utm_medium=referral`、`utm_content=footer`（英小文字）。規則の形どおり。
6. **a 要素を描く部品**: 新しい部品を作らず `ExternalLink` で描いており、lint の歯止め（a を描けるのは `ExternalLink` と `next/link` だけ）を広げていない。
7. **E-16**: 外部リンクのうち SMALLPIECE_URL と完全一致のものだけを除外し、残りは takatsu-connect.com 配下を要求。加えて、フッタ内に制作者リンクが 1 つ、ページ全体で smallpiece.jp へのリンクが 1 つであることを全画面で確かめる。
8. **規則の文の書き方**: security.md の追記「例外はフッタの制作者（Small Piece）へのリンクで、コードに固定した 1 つの URL と完全に一致するときだけ許す（ADR 0012）」は、場所・件数・一致の方法・根拠の ADR がそろい、例外を広げる読み方の余地がない。規則の冒頭の「外れる必要があるときは ADR に理由を書き、security-auditor のレビューを受ける」の手順にも沿っている（ADR 0012 あり、本監査がレビュー）。ADR 0012 の状態は本監査の結果を受けて「承認」に確定してよい。

## 依頼者に確認してもらう項目

- なし（リポジトリ外の設定に関わる変更はない）。任意として、公開後に本番のフッタのリンクが `https://smallpiece.jp/?utm_source=takatsu-connect-analyzer&utm_medium=referral&utm_content=footer` であることをブラウザで一度見ておくとよい（本監査では本番の BI に触れていない）。

## 未確認

- E-16 と U-26 の実行結果。本監査はテストを実行していない。確認方法: `apps/web` で単体テストと E2E を実行し、U-26 と E-16 が通ること。
- smallpiece.jp 側の安全性（リンク先のサイトが乗っ取られた場合の影響）。BI の資産には及ばない（noopener、origin だけの Referer）ため、監査の対象外とした。
