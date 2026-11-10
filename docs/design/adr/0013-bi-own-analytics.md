# ADR 0013: BI 自身の閲覧を GA4 で計測する

- 状態: 承認（依頼者の依頼 2026-11-10）
- 更新日: 2026-11-10
- 関係: FR-77、NFR-91、06 §6、ADR 0010（CSP と lint の歯止め）、.claude/rules/security.md「BI アプリ（Vercel）」

## 文脈

- 依頼者の依頼（2026-11-10）: 「このサイトに GA を設定したい」。目的は、BI（読まれ方ノート）がどのくらい使われているかを知ること。
- BI はこれまで、外部のスクリプトと外部への送信をすべて CSP で閉じていた（06 §6、ADR 0010）。ADR 0010 は「ログイン、Cookie、ブラウザに渡る秘密を足すとき」に見直すとしている。GA4 は Cookie（`_ga`）を置く。
- BI は検索語、期間、並び順を URL のクエリに書き戻す（`useQueryState`）。GA4 の既定の動作では、ページの URL（クエリを含む）と、拡張計測のサイト内検索（`q` などのパラメータ）が Google に送られる。

## 決定

1. **BI 用の GA4 プロパティを分ける**。測定 ID は G-XQCE22FZ2R。高津コネクト本体の G-79CFGF83VT は使わない（BI の閲覧が本体のアクセス数に混ざり、BI 自身の数字が変わるため）。コードで本体の ID を拒む。
2. 測定 ID はビルド時の環境変数 `BI_GA4_MEASUREMENT_ID` で渡し、Vercel の **Production にだけ**置く。秘密ではないが、`NEXT_PUBLIC_` は付けない（サーバー側で読み、HTML に書く）。空なら計測せず、CSP も従来のまま。ローカル、E2E、CI、Preview はこの状態。形（`G-` と英大文字・数字）が違えばビルドを止める。
3. GTM（タグマネージャ）は使わない。GTM の画面から任意のタグを足せると、CSP と lint の歯止めの外でスクリプトが増えるため。gtag.js を直接読む。
4. CSP は、計測するときだけ次を足す（Google の CSP の案内のうち広告の機能を使わない場合。確認日 2026-11-10、https://developers.google.com/tag-platform/security/guides/csp）。
   - `script-src`: `https://www.googletagmanager.com`
   - `img-src`: `https://www.googletagmanager.com https://*.google-analytics.com`
   - `connect-src`: `https://www.googletagmanager.com https://*.google-analytics.com https://*.google.com`
   - ほかの指示（`'unsafe-eval'` を入れない、`script-src-attr 'none'`、`form-action 'none'` など）は変えない。値は `apps/web/src/lib/csp.ts` の 1 か所で組み立てる。
5. script 要素を描けるのは `src/components/GaScript.tsx` の 1 つだけ（lint の例外をこのファイルに限る）。中身のない外部の script で、src は検査済みの ID から作る固定の URL。初期化は Client Component `GaPageView` が行い、インラインの script は足さない。
6. 送る内容を絞る。
   - 自動の page_view を止め（`send_page_view: false`）、パスが変わるたびに自分で送る。送る URL は**オリジンとパスだけ**（クエリとハッシュを落とす）。一覧にないパス（404）は `/_not-found` として送る。
   - Google シグナルと広告のパーソナライズを使わない（`allow_google_signals: false`、`allow_ad_personalization_signals: false`）。
   - GA4 の管理画面で、データストリームの拡張計測のうち「ブラウザの履歴イベントに基づくページの変更」と「サイト内検索」を**オフ**にする（クエリつきの URL と検索語が送られるのを止める）。データ保持は 2 か月（既定）のまま。
7. フッタの「読まれ方ノートについて」に、Google アナリティクスを使っていること、Cookie を使うこと、個人を特定する情報を集めないことを書く（計測するときだけ）。

## 理由

- 依頼の目的（利用の多さを知る）には、ページの表示とパスで足りる。クエリや検索語は要らない。
- 送り先を Google の 3 つのホストに限り、`'unsafe-eval'` も GTM も足さないので、ADR 0010 の守り（差し込まれたインラインの script が外部の任意の場所へ送れない）は Google のホスト以外では保たれる。

## 影響

- 差し込まれたスクリプトがあれば、`*.google-analytics.com` と `*.google.com` へ送れるようになる。BI のオリジンに秘密はなく（ADR 0010）、送れる先は Google に限られる。
- 訪問者の閲覧が Google に送られる（IP は GA4 が保存しない。Cookie で同じブラウザを見分ける）。BI の公開データ（`pub_*`）には何も足さない。
- 本番以外では計測しないので、E2E と `check:headers` は従来の CSP を確かめる。計測するときの CSP は単体テスト（`tests/lib/analytics.test.ts`）で確かめる。

## 代替案

- (a) Vercel Web Analytics → 06 §6 と ADR 0010 で本番では使わないと決めている。Hobby の上限もある。
- (b) 本体と同じ測定 ID → 本体の数字に混ざる。
- (c) GTM（GTM-M3QN3N4D）→ 決定 3。
- (d) 測定 ID をコードに固定 → Preview やローカルの閲覧が混ざる。
