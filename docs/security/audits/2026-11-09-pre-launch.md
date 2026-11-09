# セキュリティ監査: 初回公開前の総点検

- 状態: 草案
- 更新日: 2026-11-09
- 監査者: security-auditor
- 工程: デプロイ（BI の公開前。Vercel の Ignored Build Step でビルドを止めている状態）

## 監査の範囲と読んだファイル

過去の監査が「初回公開の前に」とした条件の照合、GitHub の設定、公開ビューの線引き、を依頼の範囲で確かめた。本番の BI、対象サイト、中継、Supabase には接続していない。git 履歴の鍵は、依頼どおり CI の gitleaks の結果で確認した。

読んだもの（全体または該当箇所）:

- `.claude/rules/security.md`、`CLAUDE.md`
- `docs/security/audits/2026-11-05-build3-review.md`（M-1、M-2、§6、§7）
- `docs/security/audits/2026-11-05-csp-script-src.md` 28〜51 行
- `docs/security/audits/2026-11-07-workflows-review.md`、`docs/security/audits/2026-11-09-wp-relay-impl-review.md`
- `docs/design/adr/0010-csp-script-src.md`、`docs/design/adr/0011-wp-fetch-relay.md`
- `.github/workflows/daily.yml`、`.github/workflows/ci.yml`、`heartbeat.yml`（Grep）、`.github/scripts/check_repo_rules.py`（Grep）
- `apps/web/next.config.ts`、`apps/web/eslint.config.mjs` 32〜38、45〜214 行、`apps/web/package.json`（Grep）、`apps/web/scripts/check-build-output.mjs` 1〜30 行、`check-headers.mjs`（Grep）、`apps/web/e2e/`（Grep）
- `supabase/migrations/0005_public_views.sql`、ほかのマイグレーション（Grep）
- `apps/batch/src/takatsu_batch/write.py` 222〜257 行と Grep、`ga4_client.py`、`ga4_period.py`、`env.py`（Grep）、`apps/wp-relay/api/relay.ts`（Grep）

実行した読み取りコマンド: `gh api`（GET のみ。リポジトリ、Actions の権限、ruleset、Environment、Dependabot と secret scanning のアラート、CI のジョブ結果）、`gh secret list`（名前だけ）、`git log`、`git ls-files`、`pnpm audit`（apps/web）。

依頼で読む文書を限定したので、`docs/operations/` と `docs/requirements/`、`docs/design/06_security.md` は読んでいない。これらに依存する項目は「確認できない」とした。

## 結論

**修正後に公開。** 致命的 0 件、高 0 件、中 3 件、低 5 件。

公開を止めるべき指摘（致命的・高）はない。ただし次の 2 つは、重要度とは別に公開前に片づける。

1. **M-1**: ADR 0010 は判断 1〜8 を「初回公開の条件」としており、そのうち判断 7 の「CI の必須チェックにする」が満たされていない。必須チェックを設定するか、ADR を改めて残るリスクを引き受けるか、依頼者の決定が要る。
2. **「依頼者に確認してもらう項目」の 1〜4**: Vercel の Build Command と fork のプレビュー、著者の旧 slug が消えたこと、表示名がログイン名でないこと。いずれもリポジトリからは確かめられない。

CSP の条件（`script-src-attr`、`object-src 'none'`、lint の出口の禁止、E2E、ビルド後の検査）は、コードと CI の結果で確認できた。

## 指摘

### 致命的

なし。

### 高

なし。

### 中

#### M-1 lint、E2E、ビルド後の検査が main の必須チェックになっていない（ADR 0010 の初回公開の条件）

- 対象: リポジトリの ruleset 26425715、`docs/design/adr/0010-csp-script-src.md` 76 行・83 行
- 問題: ADR 0010 の判断 7 は「lint、E2E、下の 8 のビルド後の検査を、CI の必須チェックにする」としており、76 行が 1〜8 を初回公開の条件と定めている。実際の ruleset のルールは `deletion` と `non_fast_forward` の 2 つだけで、ステータスチェックも PR の要求もない。CI は全ジョブが動いて成功している（後述）ので、「自動で走る」は満たすが、「落ちたら main に入らない」は満たさない。2026-11-07 の監査 M-3 と 2026-11-09 の監査 L-2 が残っている。
- 悪用の筋道: 値を HTML として描く不具合や、依存の高の脆弱性を含むコミットが、CI が赤いまま、または CI の完了前に main に入る。公開後は Vercel の Git 連携がその push でビルドする。バッチなら翌日に Secrets の下で動く。CSP は `'unsafe-inline'` なので（ADR 0010）、lint と E2E が主な守りである。第三者が直接入れる経路ではなく、書き込み権限を持つ人の誤操作の話である。
- 影響: 表示の書き換え、誘導、高の脆弱性を含むデプロイ。不具合の混入と、CI の失敗の見落としが重なったときに起きるので中とした。
- 対策: 次のどちらかを公開前に決める。
  - (a) ruleset に必須のステータスチェック（`batch`、`web`、`integration`、`static`、`deps-audit`、`wp-relay`）を足す。heartbeat は GITHUB_TOKEN で main に push するので両立の確認が要る（workflows 監査 I-4）。
  - (b) 必須にしないと決め、ADR 0010 の判断 7 と 06 §10 を「人が CI の成功を確かめる」に改め、残るリスクの受け入れを ADR に書く。
- 根拠: `gh api repos/takatsu-connect/access-analyzer/rulesets/26425715`（`rules` は上の 2 つ、`bypass_actors` は空）。`branches/main/protection` は 404 "Branch not protected"。
- 関係: ADR 0010 判断 7、security.md「依存」、NFR-45

#### M-2 本番ビルドでの `check:build` が、リポジトリの外の設定だけに依存している

- 対象: `apps/web/package.json` 12 行（`build` は `clean-fetch-cache` と `next build` だけ）、Vercel プロジェクト `takatsu-connect-analyzer` の Build Command
- 問題: ADR 0010 判断 7 の後半「ビルド後の検査は日次の本番ビルドでも走らせ、失敗したらビルドを失敗させる」は、Vercel の Build Command の設定でしか実現されていない。リポジトリに `vercel.json` はなく（`git ls-files` で確認）、設定の現状を確かめられない。今は Ignored Build Step を変えた状態で、公開時にこの画面をまた操作する。
- 悪用の筋道: Build Command が既定に戻っている、または `apps/web` 以外を指していると、`check:build` が走らないまま公開される。誤ってバンドルに Supabase の URL やキーが入っても、公開の配信で止まらない。CI 側の `check:build` はフィクスチャのビルドを見るので、本番の値が混ざる事故は検出できない。
- 影響: Supabase の URL と anon キーのブラウザへの露出（NFR-42）。キーの種類からすぐ害が出るものではないが、規則の「ブラウザは Supabase に触れない」が崩れる。
- 対策: 公開前に Build Command が `pnpm run build && pnpm run check:build` であることを確かめる（確認項目 1）。可能なら `apps/web/vercel.json` の `buildCommand` か、package.json の `build` に組み込み、リポジトリで管理する。
- 根拠: `apps/web/package.json` の scripts、`git ls-files`。監査 2026-11-07 の 206 行は「Build Command に入れた」と手順書から読んでいるが、実設定を見た記録ではない。
- 関係: ADR 0010 判断 7、NFR-42、security.md「BI アプリ」

#### M-3 Supabase CLI がロックなしの `npx` で取得されたまま

- 対象: `.github/workflows/ci.yml` 140 行、176 行（2026-11-07 の監査 M-2）
- 問題: `npx --yes "supabase@${SUPABASE_CLI_VERSION}"` のままで、依存の依存が固定されていない。リポジトリに固定用のパッケージ定義もない。監査の直後のコミット 0da15d3 の本文は「M-1 は直した」だけで、M-2 の決定の記録が見当たらない。
- 悪用の筋道: 依存の依存が侵害されると `integration` ジョブで任意のコードが動く。このジョブは Secrets を持たないので、CI の結果の偽装までである。深刻なのは、手順書が依頼者の PC で同じ形を案内している場合で、そこには Supabase の管理権限がある（手順書の現状はこの監査で未読）。
- 影響: CI の結果の信頼性。PC で動く場合は Supabase 全体。
- 対策: 2026-11-07 の監査 M-2 の案（ロックファイルで固定、またはバイナリをチェックサムで固定）のどちらかにする。今後のマイグレーションの適用の前に済ませる。
- 根拠: `ci.yml` の読み取り。`git ls-files apps/wp-relay tools` に `tools/` がない。
- 関係: security.md「依存」、06 §10、NFR-45

### 低

#### L-1 lint の抜け道のうち 2 つに規則がない（2026-11-05 の build3 監査 M-2 の 4、5）

- 対象: `apps/web/eslint.config.mjs` 135〜154 行、109〜116 行
- 問題: 変数のタグ名（`const Tag = 'a'` として `<Tag>`）と、`next/link` の `href` にデータ由来の値を渡すことを止める規則がない。ADR 0010 判断 6 は、この 2 つを禁止の列挙に入れていない。ほかに、`location = x`、`window.location = x` の形の代入は 114 行の `href` の規則に当たらない。
- 悪用の筋道: 将来の変更で `ExternalLink` の検証を素通りする。いまのコードに該当はない（`apps/web/src` への Grep で変数のタグ名と `location` への代入は 0 件。`Link` の `href` の検索語は限定的なので、網羅の確認ではない）。
- 影響: 将来の退行。
- 対策: `no-restricted-syntax` に `location` への代入を足す。変数のタグ名は、`local/` の規則で文字列を代入した `JSXIdentifier` を止めるか、ADR 0010 に「対象外」と書く。
- 根拠: 設定の読み取り。規則の実際の挙動は実行して確かめていない。

#### L-2 ADR 0011 が本番デプロイ後も「レビュー中」で、規則の断り書きも未決

- 対象: `docs/design/adr/0011-wp-fetch-relay.md` 3 行、217 行、285 行、`.claude/rules/security.md`「公開するデータ」
- 問題: 中継は本番で動いているが ADR は確定していない。slug の扱い（「表示名と著者ページの URL だけ」との字面の差）は「依頼者が決める」のままで、security.md に断り書きがない。slug はログイン名と別の値に変えられたので、ADR の 285 行の未確認事項も更新が要る。
- 悪用の筋道: 直接の悪用はない。後の担当が slug の保存を規則違反と読むか、逆に「ログイン名でも構わない」と読むおそれがある。
- 対策: ADR を確定する。security.md に「著者ページの URL に含まれる slug（ログイン名と別の値にしたもの）を保存する」と断り書きを足すか依頼者が決める。slug をログイン名と別にしておくことが今後の前提だと、著者を追加する運用の手順にも書く。

#### L-3 Environment `production` の管理者バイパスが有効、承認者なし

- 対象: Environment `production`（`can_admins_bypass: true`、保護は `branch_policy` だけ）
- 問題: デプロイ元は main に限られている（確認済み）が、管理者によるバイパスが許されている。無人の日次実行なので必須の承認者がないのは設計どおりと考えられる。
- 悪用の筋道: 管理者アカウントの侵害や誤操作で、保護の外から実行される余地がある（バイパスの及ぶ範囲はこの監査では公式文書で確かめていない）。
- 対策: 管理者のバイパスを切っても運用に支障がないか確かめ、問題なければ切る。

#### L-4 Dependabot のアラートが 1 件（中）開いたまま

- 対象: `apps/web/pnpm-lock.yaml` の `minimatch`（medium）
- 問題: 致命的・高ではないので規則には触れない。build3 監査は、これを閉じずに残すか、理由と見直し日を書いて閉じるかの判断を依頼者に求めていた（判断の記録はこの監査の範囲で見ていない）。
- 対策: 判断を記録する。`pnpm audit`（apps/web）は moderate 1 件で高以上はない。

#### L-5 CI の E2E は Chromium だけで、WebKit に CSP 違反の fixme が残る。その他の未整備

- 対象: `.github/workflows/ci.yml` 163 行、`apps/web/e2e/period.spec.ts` 153〜155 行
- 問題: 期間の選択の select で、WebKit に `style-src-attr` の違反が 1 件ある（ADR 0010 判断 8 に記録済み。操作は効く）。CI は `e2e:browsers` を流さないので、Safari 系の差はそのあとも検出されない。
- 影響: 表示への影響がなければ安全上の害はない。
- その他の低の残り: `check_repo_rules.py` に `persist-credentials` と `workflow_run` の検査がない（workflows 監査 L-1。Grep で該当なし）。`packageManager` が `pnpm@10.6.5` のままハッシュなし（relay 監査 L-3。`apps/web/package.json` 6 行、`apps/wp-relay/package.json` 7 行）。`apps/batch/uv.lock` が未追跡（`git status`。コミットするか ignore するかを決める）。

## 過去の監査の「初回公開の前に」の条件の照合

### ADR 0010 と CSP の監査（条件 1〜6）

| 条件 | 判定 | 根拠 |
| --- | --- | --- |
| 1 ADR に JSX の外の出口の禁止と lint の無効化の禁止 | 満たす | ADR 0010:82-83 |
| 2 害の記述と比較表、依頼者の引き受け | 満たす | ADR 0010:63、:96、:103 |
| 3 見直す条件（置き場所、入力欄、第三者のスクリプト） | 満たす | ADR 0010:85-91、公開は `*.vercel.app`（:102） |
| 4 lint の規則の実装 | 満たす | eslint.config.mjs:32-38、:62-117、:157-162 |
| 4 lint、E2E、ビルド後の検査が自動で走る | 満たす（CI）。本番は確認できない（M-2） | ci.yml:82、:151-163。4c51aa4 の run 42574845744 で `web`、`integration` の該当ステップがすべて success |
| 5 `script-src-attr 'none'` | 満たす | next.config.ts:14、check-headers.mjs:26（期待値）、inline-script.spec.ts:207。全 21 画面は ADR 0010:84 の記録 |
| 6 `object-src 'none'` | 満たす | next.config.ts:19、check-headers.mjs:31 |

### ADR 0010 の「かわりに守ること」1〜8

| # | 判定 | 根拠 |
| --- | --- | --- |
| 1 script、iframe 等の lint 禁止 | 満たす | eslint.config.mjs:135-154、:155 |
| 2 `dangerouslySetInnerHTML`、`style` の禁止、値は文字列で描く | 満たす | eslint.config.mjs:91、:127-128、:130。inline-script.spec.ts:237、:282 |
| 3 値から URL を作らない | 満たす（L-1 の残りあり） | eslint.config.mjs:105-116、:167-168、inline-script.spec.ts:345 |
| 4 CSP の値 | 満たす | next.config.ts:11-23。`'unsafe-inline'` は `script-src` の 1 か所、`'unsafe-eval'` などなし。`check-headers` で全一致を照合 |
| 5 E2E | 満たす | inline-script.spec.ts:109-182、CI で success |
| 6 JSX の外の出口の禁止 | 満たす | eslint.config.mjs:32-38、:62-117、:157-165。`tests/lint/eslint-config.test.ts` が `check` 経由で CI に入る |
| 7 `noInlineConfig` | 満たす | eslint.config.mjs:55、`--max-warnings 0` |
| 7 CI の必須チェック | **満たさない** | M-1 |
| 7 本番ビルドでの検査 | **確認できない** | M-2、確認項目 1 |
| 8 `script-src-attr` の実機確認と記録 | 満たす | ADR 0010:84（WebKit の残りは L-5） |

`check:headers` は `next start` への検査で、CI でだけ動く（check-headers.mjs:106-108）。Vercel 上の実際の応答ヘッダを自動で見るものはない（確認項目 5）。

### build3 監査（M-1、M-2、§7）

| 指摘 | 判定 | 根拠 |
| --- | --- | --- |
| M-1 検索欄と見直し条件 | 満たす | ADR 0010:88-89、:78。E2E は inline-script.spec.ts:254 |
| M-2 の 1 DOM へのスプレッド | 満たす | eslint.config.mjs:120-123 |
| M-2 の 2 `createElement` の props | 満たす | :91、:95-98 |
| M-2 の 3 `createElement('script')` の形 | 満たす | :95-98、:155 |
| M-2 の 4 変数のタグ名 | 満たさない（低） | L-1 |
| M-2 の 5 `next/link` の `href` | 満たさない（低） | L-1 |
| M-2 の 6 移動の出口 | 満たす（L-1 の形を除く） | :105-116 |
| M-2 の 7 `setAttribute` | 満たす | :100 |
| §6 L-3 参照元ドメインの形 | 満たす | ga4_client.py:74-75 で次元は `sessionSource` のみ。ga4_period.py:222、:251 で `normalize_referrer` を通す。関数の中身は未読 |

### workflows 監査（2026-11-07）の残り

| 指摘 | 判定 | 根拠 |
| --- | --- | --- |
| M-1 heartbeat の間隔 | 満たす | heartbeat.yml:11 週 1、:34 45 日（52 < 60） |
| M-2 Supabase CLI の固定 | 満たさない | M-3 |
| M-3 必須チェック | 満たさない | M-1 |
| M-4 依存・Action・アカウント侵害の手順（runbook §9.4） | 確認できない | runbook は監査後に変更あり（1e4f5c7、b5e55fb）だが依頼の範囲外で未読。確認項目 6 |
| L-1 検査の追加 | 満たさない（低） | L-5 |
| L-2、L-3、L-4、L-5（手順書と 06 §3） | 確認できない | 手順書は未読。確認項目 6 |

### 中継の実装監査（2026-11-09）の残り

| 指摘 | 判定 | 根拠 |
| --- | --- | --- |
| M-1 手順書 | 手順書の追加は確認、内容は確認できない | コミット b5e55fb が deploy.md と runbook.md を変更（件名は中継の手順書と 06・07 の項目の追加） |
| L-1 トークンの下限 | 満たす | relay.ts:11、:222。env.py:30（64 文字以上） |
| L-2 必須チェック | 満たさない | M-1 |
| L-3 pnpm の integrity | 満たさない（低） | L-5 |

## GitHub の設定

`gh api` の GET で確認（2026-11-09）。

| 項目 | 結果 | 判定 |
| --- | --- | --- |
| secret scanning | enabled | 問題なし |
| push protection | enabled | 問題なし |
| secret scanning の開いたアラート | 0 件 | 問題なし |
| 非プロバイダのパターン、validity checks | disabled | 任意の機能。指摘にしない |
| main の保護 | classic は 404。ruleset（active、bypass なし）に `deletion`、`non_fast_forward` | force push と削除は禁止。必須チェックなし（M-1） |
| Dependabot alerts | 有効（`vulnerability-alerts` が 204） | 問題なし。開いたアラートは minimatch の medium 1 件（L-4） |
| Dependabot security updates、`dependabot.yml` | enabled、追跡済み | 問題なし |
| GITHUB_TOKEN の既定 | `read`、PR の承認不可 | 問題なし |
| Actions | `selected`、`sha_pinning_required: true` | 問題なし |
| fork の PR の承認 | `all_external_contributors` | 問題なし |
| Environment `production` | デプロイ元は branch `main` のみ、`can_admins_bypass: true` | L-3 |
| Secret の置き場（名前のみ） | リポジトリ: `GA4_PROPERTY_ID`、`GCP_SERVICE_ACCOUNT`、`GCP_WORKLOAD_IDENTITY_PROVIDER`。Environment: `SUPABASE_BATCH_DB_URL`、`VERCEL_DEPLOY_HOOK_URL`、`WP_RELAY_TOKEN`、`WP_RELAY_URL` | 問題なし。接続文字列は main 限定の Environment にだけある |

git 履歴の鍵: 最新の main（4c51aa4）の CI、run 42574845744 の `static` ジョブで「gitleaks（全履歴。値は伏せて出す）」が success。`ci.yml` 186 行の `fetch-depth: 0` で全履歴を対象にしている。追跡されている `.env` 系は `.env.example` だけ（`git ls-files`）。

## 公開ビューの線引き

`0005_public_views.sql` の 34 個の `pub_*` の列を読んだ。

| security.md の線引き | 判定 | 根拠 |
| --- | --- | --- |
| ユーザー ID、クライアント ID、IP | ない | 全ビューの列の一覧。他のマイグレーションに `author_id`、`wp_user_id`、`email`、`user_login` の一致なし |
| 完全な参照 URL | ない | 公開は `source_domain` だけ（:227、:265）。GA4 の次元は `sessionSource` で、`pageReferrer`、`fullReferrer` はコードに一致なし |
| サイト内検索語、フォームの内容、リアルタイムの値 | ない | 全ビューの列の一覧 |
| 市区より細かい地域 | ない | `pub_site_month_city` は `region`、`city`、`sessions`（:234） |
| 伏せ値の内部列 | ない | `_mask` 列を出さず、:571-575 の検査が適用時に失敗させる |
| 運用情報 | 問題なし | `pub_batch_run` の `error_kind`、`failed_step` は固定の列挙（0004:40、:43） |
| anon の権限 | 問題なし | 各ビューに select だけ。:454-466 と、:469-599 の検査が適用時に確かめる |
| ログイン名に当たるもの | 依頼者の確認が前提 | 下記 |

**著者の slug**: `author_slug` は `pub_author`（:132）、`pub_post`（:141）、`pub_author_period`（:328）、`pub_author_period_breakdown`（:342）、`pub_author_category_period`（:348）、`pub_author_summary`（:365）に出る。依頼者がログイン名と別の値に変えたので、ログイン名には当たらない前提で問題はない。

旧 slug は仕組みの上では残らない。バッチは今回の取得にない著者を消し（write.py:305）、`author_period_breakdown` と `author_summary` は `on delete cascade` で一緒に消える（0002:141、0003:79）。ただし `wp_post.author_slug` の外部キーに cascade はなく（0001:79）、差分取得で更新されなかった記事が旧 slug を指していると、削除が失敗してバッチが止まる。全件を取り直す backfill では起きないはずで、**backfill の完了後に旧 slug がないことの確認が要る**（確認項目 3）。

**表示名**: `display_name` は WordPress の表示名である。WordPress では表示名の初期値がログイン名になることがあるので（監査者の知識）、slug を変えても表示名がログイン名のままの著者がいれば、`pub_author` と画面に出る（確認項目 4）。

**数値**: `pub_author_period` は著者ごとの PV の合計を持つ。画面の並べ替えはないが、S-08 と S-02e の JSON から比較できる残りは build3 監査の I-1 のとおりで、変更はない。

**脅威モデルとの差分**: 脅威モデルは「検索エンジン経由でも来る」とするが、実装は `X-Robots-Tag: noindex, nofollow`（next.config.ts:30）で、E2E も noindex を確かめている（csp.spec.ts:236）。CLAUDE.md の記載どおり Q-04 で noindex と決まっているので、設計を正とする。

## 依頼者に確認してもらう項目

公開前に確かめてほしいもの:

| # | 項目 | 場所 | 関係 |
| --- | --- | --- | --- |
| 1 | Build Command が `pnpm run build && pnpm run check:build`、Root Directory が `apps/web` のままであること。Ignored Build Step を戻すときに併せて見る | Vercel `takatsu-connect-analyzer` の Build 設定 | M-2 |
| 2 | fork の PR でプレビューをビルドしないこと。Standard Protection が有効なこと。GitHub App の対象がこのリポジトリだけなこと | Vercel のプロジェクト設定 | 2026-11-07 確認項目 6 |
| 3 | backfill の完了後、公開ビューに旧 slug の著者が残っていないこと。`author_url` が新しい URL であること | 親または依頼者が Supabase で `pub_author` を見る（値を文書やログに書かない） | 公開ビューの節 |
| 4 | 著者全員の表示名がログイン名でないこと | WordPress の管理画面 | 公開ビューの節 |
| 5 | 公開後に 1 回、実 URL の応答ヘッダが CSP を含めて `next.config.ts` と一致すること。`script-src-attr` と `object-src` が出ていること | 依頼者がブラウザの開発者ツールで見る（監査者は本番に接続しない） | build3 §7 |

公開前か、公開後すぐの定期点検で確かめてほしいもの:

| # | 項目 | 場所 | 関係 |
| --- | --- | --- | --- |
| 6 | runbook §9.4（依存・Action・アカウントの侵害）と §9.1 の影響範囲の確認があること。中継のローテーションと停止の手順の内容 | `docs/operations/runbook.md`、`deploy.md`。次回の監査の範囲に含める | workflows M-4、L-2〜L-5、relay M-1 |
| 7 | WIF の属性条件（repository、repository_id、ref）。SA に GA4 閲覧者以外の権限がないこと。`USER_MANAGED` の鍵がないこと | GCP | 脅威モデル |
| 8 | Vercel に anon キーだけがあり、service role キーがどこにもないこと | Vercel、Supabase | security.md「秘密情報」 |
| 9 | 中継の Firewall のレート制限、費用の通知、基盤のログの項目と保持期間 | Vercel のチーム設定 | ADR 0011 未確認の事項 |
| 10 | GitHub、GCP、Supabase、Vercel の管理者の一覧と 2 要素認証。ライターの WordPress アカウントの 2 要素認証（ADR 0010:104 で未設定） | 各サービス | 観点 7 |

## 依頼者の判断が要ること

1. M-1: 必須チェックを設定するか、ADR 0010 を改めてリスクを引き受けるか。
2. M-3: Supabase CLI の固定の方法。
3. L-2: security.md に slug の断り書きを足すか。
4. L-4: minimatch のアラートを残すか、理由を書いて閉じるか。

## 未確認

| 項目 | 確認方法 |
| --- | --- |
| Vercel 上の実際のヘッダ、ビルド設定、プレビューの設定 | 確認項目 1、2、5 |
| 本番の Supabase の実データ（旧 slug、RLS と権限の実状態） | 確認項目 3。権限は deploy.md の検査 SQL（A-11） |
| `docs/operations/` と `docs/requirements/`、06 の内容 | 依頼の範囲外。次回の監査で読む |
| lint の規則の実際の挙動のうち、L-1 の形 | 落ちるべきファイルを lint にかける |
| `normalize_referrer` の中身 | `ga4_period.py` の関数を読む（build2 の範囲では確認済みのはずだが、今回は未読） |
| Environment の管理者バイパスの及ぶ範囲（L-3） | GitHub Docs の事実票 |
| RLS の表と内部表の一対一の対応 | `enable row level security` は 25 か所で `batch_writer` の許可表の 25 個と同数。一対一の照合はしていない。CI の結合テストと A-11 の範囲 |
| `apps/wp-relay` の pnpm audit と pip-audit の当日の結果 | 最新 main の `deps-audit` ジョブの成功で代用した |

## 問題なしと確認した項目

- `daily.yml`: 最上位 `contents: read`、`id-token: write` は `daily` と `backfill` だけ（:54、:92）。全ジョブに `github.ref == 'refs/heads/main'` と `DAILY_ENABLED` の条件。`environment: production`。`persist-credentials: false`。依存はハッシュ固定。`run:` で入力を展開せず env で渡す。接続文字列と中継の Secret はバッチのステップの `env` だけ。`publish_only` に渡るのは Deploy Hook だけ（:154）。
- `ci.yml`: `contents: read` だけ。`pull_request_target` なし。`secrets.` の参照なし。Action は SHA 固定。gitleaks は全履歴を `--redact` で走査。`deps-audit` は高以上で失敗。
- 最新の main の CI（4c51aa4、run 42574845744）: `batch`、`web`、`integration`、`static`、`deps-audit`、`wp-relay` の 6 ジョブすべて success。`check:build`、`check:headers`、E2E（Chromium）、gitleaks のステップも success。
- 応答ヘッダ: `next.config.ts` の `headers()` が全パスに CSP、`X-Content-Type-Options`、`Referrer-Policy`、`X-Frame-Options`、`frame-ancestors`、`X-Robots-Tag` を付ける。`check-headers` が CSP を照合する。
- `check:build` は値が取れないと終了コード 2 で失敗する（check-build-output.mjs:48、:84-86）。空の環境で通ってしまうことがない。
- 依存: `pnpm audit`（apps/web）は moderate 1 件で高以上なし。ロックファイルは追跡済み。
