# ADR 0012: フッタに制作者（Small Piece）へのリンクを置く

- 状態: 承認（security-auditor の監査 audits/2026-11-10-smallpiece-link.md。致命的・高・中 0）
- 更新日: 2026-11-10
- 関係: .claude/rules/security.md「BI アプリ（Vercel）」、.claude/rules/smallpiece-link.md、06 §7、05 §2.7、U-26、E-16

## 文脈

- 依頼者の依頼（2026-11-10）: 「Small Piece へのリンクを、小さくてもいいのでフッターにつけてください」。リンクの形は .claude/rules/smallpiece-link.md（claudecode-initial-settings の smallpiece-link v1。2026-11-03 導入済み、配布元と同じ内容を確認）に従う。
- .claude/rules/security.md には「外部へのリンク先は takatsu-connect.com に固定する。利用者の入力からリンク先を作らない」とある。BI の外部リンクは、行き先を検査する部品 `ExternalLink`（`safeExternalUrl`）だけが描き、E2E（E-16）が全画面の外部リンクが takatsu-connect.com の配下だけであることを確かめている。
- この規則の目的は、データ（記事の URL、著者ページの URL）や利用者の入力から、意図しない行き先（`javascript:`、別のサイト）へのリンクが作られないようにすることである。

## 決定

- フッタに小さな字で「制作 Small Piece」を置き、`https://smallpiece.jp/?utm_source=takatsu-connect-analyzer&utm_medium=referral&utm_content=footer` へ新しいタブで開くリンクにする（`rel="noopener"`、外部のアイコンつき、読み上げの名前で行き先と新しいタブを伝える）。
- この URL はコードの定数 `SMALLPIECE_URL`（`src/lib/derive/links.ts`）に 1 つだけ書く。`safeExternalUrl` は、takatsu-connect.com の配下に加えて、この定数と**完全に一致する**文字列だけを通す。前方一致やドメインの一致では通さない（別のパス、`http:`、余分なパラメータ、似たドメインは通らない。単体テスト U-26）。
- E-16 は「takatsu-connect.com の配下と、フッタの制作者のリンク（この URL）だけ」を確かめる形にし、smallpiece.jp へのリンクが各ページに 1 つだけであることも確かめる。

## 理由

- 行き先はデータや利用者の入力に依らず、コードに固定した 1 つの URL なので、規則の目的（入力やデータからリンク先を作らない）は保たれる。
- 検査の部品を 1 つに保ち（`a` 要素を描けるのは `ExternalLink` と `next/link` だけ、の lint はそのまま）、許可を完全一致の 1 件に限ることで、例外が広がらない。

## 影響

- 訪問者がリンクを押すと、Small Piece のサイトに BI の origin（Referrer-Policy: strict-origin-when-cross-origin）と UTM が渡る。訪問者の個人情報や BI のデータは渡らない。BI 側に計測や外部の読み込みは増えない（CSP は変えない）。
- .claude/rules/security.md の該当の行と、06 §7 に、この ADR による例外を書き足した。
- リンクを置く場所（フッタに 1 つだけ）はコードでは決めておらず、E2E の E-16 で確かめる（監査の低-3）。

## 代替案

- (a) リンクにせず文字だけ置く → 依頼は「リンク」。
- (b) smallpiece.jp のドメインを許可する → 例外が広がる。固定の 1 件で足りる。
- (c) `ExternalLink` と別の部品で描く → `a` 要素を描ける部品が増え、lint の例外も増える。
