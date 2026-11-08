# 運用手順

- 状態: 草案
- 更新日: 2026-11-09

日々の運用と、失敗・漏えい・期限のときの手順。気づき方は monitoring.md、設定値の置き場所は environments.md、初回の構築は deploy.md。

- **本番を変える手順（手動の実行、Secrets とパスワードの変更、SQL の実行、Vercel の操作）は依頼者の確認が要る。** エージェントは依頼者の指示なしに実行しない。
- 値（パスワード、接続文字列、Hook の URL、プロパティ ID）は、Issue、コミット、チャット、ログに書かない。

## 1. 日々の確認

| 頻度 | 見るもの | 正常な状態 |
| --- | --- | --- |
| 毎日（任意。通知がなければ省いてよい） | GitHub からの失敗メール | 届かない |
| 毎日（任意） | BI の画面の「◯月◯日までのデータ」 | 前日の日付。「更新が遅れています」が出ていない |
| 週 1 | Actions の `audit` の結果、Dependabot の PR | `audit` が成功。PR は §12 で処理する |
| 月 1（必須。03 §12） | Actions の実行一覧（`daily` が毎日動いているか、`heartbeat` が動いたか）、Vercel のビルド履歴 | `daily` が毎日 success（2 本目の 18:00 は成功の後なので何もせず success）。止まっていない |
| 月 1 | `internal.batch_run` の直近 30 日（monitoring.md §4） | `failed` が続いていない。`ga4_tokens` が見込みの 3 倍以内 |
| 月 1 | Vercel の `takatsu-connect-wp-relay` の使用量（§14.3） | バッチが成功している日の実行回数が 1 日数十回 |
| 年 1 | §8 のローテーション | ― |

## 2. 失敗の通知を受けたとき

GitHub の失敗メールの「View workflow run」から実行を開き、失敗したジョブのログの最後の行を見る。バッチは JSON の 1 行で `{"step":"<工程>","kind":"<種別>"}` を出す（03 §14）。工程の前で止まったときは `step` が `startup`。ログに出るのは種別までで、例外の本文は出ない（設計どおり）。

| 工程 / 種別 | よくある原因 | 対処 |
| --- | --- | --- |
| `startup` / `validation` | 環境変数の欠け、形の誤り（接続文字列にクエリ文字列がある、Hook の URL の形、`GA4_PROPERTY_ID` が数字でない）、`from` / `to` / `base_date` の形の誤り | Environment とリポジトリの Secrets の名前を確かめる（environments.md §3）。手動実行なら入力を直して再実行 |
| `GCP に WIF で認証する` のステップで失敗 | WIF の属性条件、SA の権限、main 以外からの実行 | `wif-check` を流して切り分ける（deploy.md 手順 2） |
| `ga4_daily` / `ga4_period` の `quota` | GA4 の割当の超過 | §7 |
| `ga4_*` の `auth` | SA の GA4 の権限が外れた、WIF の設定の変更 | GA4 の管理画面で SA が閲覧者か確かめ、`wif-check` |
| `ga4_*` / `wp_fetch` の `network` | 一時的な障害 | 翌日の実行で直近 7 日を取り直すので、1 日だけなら何もしなくてよい（03 §9）。急ぐなら `mode=daily` で再実行 |
| `wp_fetch` の `network`（中継の経路） | 中継の認証や許可リストの不一致、上流の拒否（出口 IP が国外に振られた場合を含む）。3xx と 429 以外の 4xx は再試行せずに止まる | §14.2 |
| `wp_fetch` の `validation` | WP の応答の形の変化、削除の上限（`WP_DELETE_GUARD_*`）に当たった | 対象サイトで記事が大量に非公開になっていないかを依頼者が確かめる。対象サイトの設定は変えない |
| `preflight` / `write` の `network` | Supabase の一時停止（§10）、pooler の障害、CA の交換（§11） | Supabase のダッシュボードでプロジェクトの状態を見る。2 日以上続いたら §11 |
| `preflight` / `write` の `auth` | `batch_writer` のパスワードの不一致 | ローテーションの途中なら §8 の手順を確かめる。覚えがなければ §9 |
| `write` の `db` | スキーマとコードの食い違い（マイグレーションの未適用） | `supabase migration list` で本番の適用状況を見る（deploy.md 手順 3） |
| `publish` の `network` | Deploy Hook の失敗。データは書けている | §3 の `publish_only` |
| `unknown` | 分類できない例外 | 再実行して再現するか見る。再現するなら Issue にして、ローカルで同じ基準日（`BASE_DATE`）で再現させる |

- 失敗が続く間は、BI は前回のデータのまま表示され、2 日たつと「更新が遅れています」が出る（NFR-90）。WordPress で取り下げた記事の反映も止まる（03 §14）。
- 対処の期限の目安: 3 日以内に原因を特定して直す。7 日を超えて止まると、直近 7 日の再取得だけでは埋まらない日が出るので、直した後に §4 の backfill を流す。

再実行（依頼者の確認が要る）:

```
gh workflow run daily.yml --repo takatsu-connect/access-analyzer --ref main -f mode=daily
```

## 3. publish_only

使うとき: `failed_step = publish` の日、Vercel のビルドが失敗した後の再試行、設定値や `ui-text.ts` の変更の後の再ビルド。データは更新せず、`batch_run` に行を書かない（03 §2、L-7）。依頼者の確認が要る。

```
gh workflow run daily.yml --repo takatsu-connect/access-analyzer --ref main -f mode=publish_only
```

確かめ方: `publish_only` のジョブが成功し、Vercel の Deployments に Deploy Hook のビルドが出て成功する。

- Deploy Hook は 1 時間に 60 回まで（プロジェクト全体。Vercel Docs「Deploy Hooks」、2026-11-07 確認）。連打しない。
- Vercel のビルドが `check:build` で失敗したときは、Vercel のビルドログで検査の項目を見る。データの時点の食い違いなら、もう一度 `publish_only` を流す（fetch-cache は毎回消している）。

## 4. backfill

使うとき: 初回、8 日以上の連続した失敗の後、`posts_late_seen` が 0 でない日（§5）、集計の不具合を直した後、漏えい後の作り直し（§9）。依頼者の確認が要る。

```
gh workflow run daily.yml --repo takatsu-connect/access-analyzer --ref main -f mode=backfill
```

期間を絞るとき（`YYYY-MM-DD`）:

```
gh workflow run daily.yml --repo takatsu-connect/access-analyzer --ref main -f mode=backfill -f from=2026-10-01 -f to=2026-10-31
```

- JST 15:30 より後に始める。所要の見込みは 6〜8 分、上限 60 分。冪等なので、失敗したら原因を直してそのまま最初から流してよい（03 §10）。
- 割当の残量（1 時間）が 2,000 を下回るとバッチが `quota` で止まる。1 時間後に再実行する（§7）。
- 終わったら monitoring.md §4 の SQL で `success` と `ga4_tokens` を確かめる。

## 5. posts_late_seen が 0 でない日

意味: 公開から 8 日以上たって初めて取り込んだ記事がある（再公開、長くパスワード付きだった記事の公開、公開日をさかのぼった公開、8 日以上の失敗の後）。その記事の日別の値が直近 7 日ぶんしかなく、合計・累積・7 日と 30 日の値が小さく出る（03 §9）。

見つけ方: 成功した `daily` のログで `{"step":"wp_fetch","count":"posts_late_seen","n":<数>}` の `n`。`batch_run.counts` には入っていない（ログだけ）。

対処: 急がない。その週のうちに §4 の backfill を（期間を絞らずに）1 回流す。全期間を取り直すので値が戻る。daily の中で自動で取り直すかは初回公開後に決める（03 §9）。

## 6. 取り下げた記事が BI に残っているとき

- 通常は、WordPress で非公開・下書き・パスワード付き・削除にした記事は、次の日次バッチ（JST 17:00）で関連する集計とともに消え、Vercel の再ビルドで画面からも消える（FR-72、NFR-52）。
- 翌日になっても残っているときは、バッチが失敗している（書き込みは工程 6 でまとめて行うので、GA4 の工程で失敗すると削除も書かれない。03 §14）。§2 で直すか、データが書けていて画面だけ古いなら §3 の `publish_only`。
- 急いで消したいとき（例: 誤って公開した記事）: `mode=daily` を手動で実行する。同じ基準日の成功が既にあれば daily は何もせずに終わる（二重実行の防止）ので、その場合は `mode=backfill` を流す。依頼者の確認が要る。期限の目安は依頼を受けた当日中。
- 対象サイト（WordPress）の設定は変えない。

## 7. GA4 の割当を超えたとき

- 事実（03 §11、2026-11-03 に親が確認）: Core トークン 1 日 200,000、1 時間 40,000、1 プロジェクト × プロパティ 1 時間 14,000。通常日の見込みは約 490、backfill は約 5,200。
- `quota` で止まったら、1 時間あけて再実行する。翌日まで待てば daily が直近 7 日を取り直すので、日次なら何もしなくてもよい。
- 2 日続けて `quota` になったら、`batch_run.counts` の `ga4_tokens`、`ga4_tokens_remaining_day`、`ga4_tokens_remaining_hour` を見る。同じ GCP プロジェクトで他に GA4 を使っていないか（ローカルの確認用の借用を含む）を確かめる。見込みの 3 倍を超える消費が続くなら D-01 を開き直す（設計の見直し。architect に依頼）。

## 8. 鍵とパスワードのローテーション

すべて依頼者の確認が要る。年 1 回（例: 毎年 11 月）と、運用担当が退任したときに行う（06 §3）。

### 8.1 batch_writer のパスワード（年 1 回）

1. JST 17:00〜18:30 の実行と重ならない時間に行う。
2. deploy.md 手順 4 の 1 で新しい値を作る。
3. SQL エディタで `alter role batch_writer with password '<新しい値>';`（保存済みのスニペットにしない）。
4. Environment `production` の `SUPABASE_BATCH_DB_URL` を、新しい値の接続文字列で上書きする。
5. `mode=daily` を手動で実行し、成功を確かめる（同じ基準日の成功があれば何もせず success になり、接続の確認にならない。その場合は翌日の schedule の成功で確かめる）。

### 8.2 Deploy Hook の URL（漏えいの疑いがあるとき。定期は任意）

1. Vercel の Settings → Git → Deploy Hooks で新しい Hook を作る。
2. Environment の `VERCEL_DEPLOY_HOOK_URL` を上書きする。
3. 古い Hook を消す。
4. §3 の `publish_only` で確かめる。

### 8.3 GCP（WIF）

長生きする鍵はないのでローテーションは不要。年 1 回、SA に JSON 鍵がないこと（deploy.md 手順 11 の確かめ方）と、WIF の属性条件が変わっていないこと（deploy.md 手順 1 の確かめ方）を見る。

### 8.4 Supabase の anon キー

公開ビューの読み出しにしか効かないので、定期のローテーションは任意（06 §3）。変えるときは Vercel の `SUPABASE_ANON_KEY` を更新して `publish_only`。

### 8.5 Supabase の postgres のパスワード

年 1 回、Supabase の Database settings でリセットし、パスワード管理ツールを更新する。バッチと BI は使っていないので影響はない。

### 8.6 WP_RELAY_TOKEN（中継のトークン）

年 1 回、運用担当の退任時、漏えいの疑いがあるときに行う（ADR 0011 §3）。漏えいのときは §9.4 の順序で行う。

1. JST 17:00〜18:30 の実行と重ならない時間に行う。手順 2 から 4 の間は GitHub と Vercel の値が食い違い、バッチが 401 で失敗する。
2. deploy.md 手順 8.5 の「トークンを作って Vercel に登録する」で新しい値を作り、Vercel の `WP_RELAY_TOKEN`（Production だけ、Sensitive）を置き換える。
3. deploy.md 手順 8.5 の「main のチェックアウトからデプロイする」で新しくデプロイする（CI の成功の確認を含む）。
4. **旧トークンを持つ過去のデプロイをすべて削除する。** Deployments の一覧に、残っているのが新しいデプロイだけであることを確かめる。環境変数を変えたときに過去のデプロイの値がどうなるかは未確認なので、結果によらず削除する。画面操作は未確認（§13）。
5. Environment `production` の `WP_RELAY_TOKEN` を新しい値で上書きする（deploy.md 手順 8.5 の `gh secret set`）。一時ファイルを消す。
6. `mode=daily` を手動で実行し、成功を確かめる。同じ基準日の成功があれば何もせず success になり確認にならないので、その場合は翌日の schedule の成功で確かめる。

- **ロールバックしない。** 過去のデプロイへ戻すと旧トークンが有効に戻りうる。戻す必要があれば、main の修正を新しくデプロイする。
- 旧トークンが無効かを、旧トークンで中継を呼んで確かめない（まだ有効なら要求が WordPress に届く）。確認は Vercel の設定とデプロイの一覧で行う。

## 9. 漏えいしたとき

### 9.1 SUPABASE_BATCH_DB_URL（06 §3 の W-2。順序を守る）

1. `DAILY_ENABLED` を `false` にする（作り直しの途中で daily が動かないように）。
2. SQL エディタで `alter role batch_writer with password '<新しい値>';`。
3. 既存のセッションを切る: `select pg_terminate_backend(pid) from pg_stat_activity where usename = 'batch_writer';`（パスワードの変更では切れない前提。ADR 0009 V-4）。
4. Environment の `SUPABASE_BATCH_DB_URL` を更新する。
5. 容量を埋められていたら、不要な行を消し、Free の容量を確かめる（06 §3、経路監査 L-3）。消し方は未確定（03 §17。`batch_writer` には truncate がない。管理者の SQL で行う場合も、ダッシュボードの手変更の禁止はスキーマに対するもので、データの削除は記録を残して行う）。
6. `DAILY_ENABLED` を `true` に戻し、§4 の backfill を期間を絞らずに流す。直近 7 日より古い改ざんは daily では直らないので、省略しない。
7. Vercel で再ビルドされたことを確かめ、改ざんされた値を含みうる旧デプロイを消す（Deployments の各行のメニューから削除。06 §2.4）。
8. security-auditor に報告し、経緯を Issue に残す（値は書かない）。

### 9.2 VERCEL_DEPLOY_HOOK_URL

影響は「第三者が再ビルドを起こせる」こと（1 時間 60 回の上限を消費され、日次のビルドが失敗しうる）。§8.2 で作り直す。

### 9.3 秘密が git の履歴に入ったとき

履歴を消すより先に、その秘密を無効化して再発行する（上の手順）。そのあと、履歴の書き換えが要るかを依頼者と security-auditor が判断する（main の force push はルールセットで禁止されている）。

### 9.4 WP_RELAY_TOKEN

影響は、公開済みの記事メタデータを許可リストの範囲で読まれること、WordPress への負荷（1 秒の間隔を守らずに読める）、Vercel の費用。ログイン画面など許可リストの外には届かない。

無効化を優先し、バッチの失敗が出ても次の順で行う。

1. §8.6 の 2 と 3 で新しいトークンをデプロイする。すぐに新しいデプロイを出せないときは、§14.1 の「中継を止める」を先に行う。
2. §8.6 の 4 で過去のデプロイをすべて削除する。
3. §8.6 の 5 と 6 でバッチを戻す。
4. security-auditor に報告し、経緯を Issue に残す（値は書かない）。

## 10. GitHub の 60 日無活動と Supabase の一時停止

- public リポジトリの schedule は、60 日間リポジトリに活動がないと止まる（03 §12）。`heartbeat.yml` が毎週月曜に、main の最新コミットが 45 日以上前なら `ops/heartbeat.txt` をコミットする。通常は Dependabot や文書の更新で活動があり、heartbeat は何もしない。
- 止まってしまったとき: Actions の画面で `daily` に「This scheduled workflow is disabled」などの表示が出る。Actions → `daily` → Enable workflow で再開し（依頼者の確認が要る）、`mode=daily` を手動で実行する。止まっていた日数が 7 日を超えていれば §4 の backfill。
- Supabase Free は 1 週間アクセスがないと一時停止する。バッチが止まると 1 週間後に止まる。復旧は、Supabase のダッシュボードでプロジェクトを再開 → `mode=daily`（または backfill）の順（03 §12）。
- heartbeat のコミットが本当に「活動」として数えられるかは確かめていない（§13）。月 1 の確認で `daily` が止まっていないかを見る。

## 11. CA の失効と交換

- 接続の TLS の失敗は `network` に分類され、一時的な障害と区別できない（ADR 0009「CA の失効と交換」）。
- `preflight` か `write` の `network` が 2 日続き、Supabase のダッシュボードで障害が出ていないときは、認証情報なしで現在の鎖を確かめる（host 名とその出力を文書やログに書かない）。

```
openssl s_client -starttls postgres -connect <POOLER-HOST>:5432 -showcerts -CAfile apps/batch/certs/supabase-root-2021.crt
```

- `Verification: OK` でなければ、Supabase のダッシュボードから新しい CA を取り、`apps/batch/certs/` を差し替える PR を作る（security-auditor の確認を受ける）。
- 控えの期限（ADR 0009、2026-11-04 確認）: CA（Supabase Root 2021 CA）は 2031-04-26、pooler のサーバー証明書は 2030-03-11。2030-01 に一度確かめる。

## 12. 依存の更新（Dependabot）

- 毎週月曜に PR が来る。`cooldown` で、公開から 7 日（`.github/requirements` は 14 日）たった版だけが提案される。セキュリティ更新には cooldown が効かない（GitHub Docs「Dependabot options reference」、2026-11-07 確認）。
- 自動 merge はしない。人が次を見てから merge する: CI がすべて通る、変更履歴に不審な点がない（新しい保守者、急なインストールスクリプト）、pip の PR では `requirements.txt` のハッシュが更新されている。
- pip の最初の PR で、Dependabot が pip-compile のハッシュを作り直すことを確かめる（06 §10）。作り直さなければ、PR を閉じて手元で `pip-compile --generate-hashes` を流して PR にする。`.github/requirements/audit.txt` は uv で生成しているので、Dependabot が更新できるかも最初の PR で確かめる。
- pip-audit が誤検知や修正版のない脆弱性で落ちるときは、`.github/scripts/pip-audit.sh` の `IGNORES` に ID と理由を足す PR を作る。

## 13. 確認が要ること

1. GITHUB_TOKEN による heartbeat のコミットが、60 日の無活動の判定で「活動」として数えられるか。
2. Vercel の旧デプロイの削除の画面操作と、Hobby での保持の設定（中継は Pro のプロジェクトで、同じく削除の画面操作が未確認）。
3. 漏えい時に攻撃者が足した行の消し方（03 §17）。
4. `posts_late_seen` を `batch_run.counts` にも残すか（いまはログだけ）。

## 14. WordPress 取得の中継（ADR 0011）

中継の配置とデプロイは deploy.md 手順 8.5。Vercel と GitHub の操作は依頼者の確認が要る。

### 14.1 中継を止める

止め方は 2 通りあり、効果が違う。

| 目的 | 操作 | 効果 |
| --- | --- | --- |
| **中継を止める**（漏えいの疑いを含む） | Vercel の `takatsu-connect-wp-relay` の環境変数 `WP_RELAY_TOKEN` を消し、deploy.md 手順 8.5 の手順で再デプロイする。漏えいのときは過去のデプロイも削除する（環境変数との関係が未確認のため） | トークンが未設定になり、すべての要求が 401 になる（fail closed。ログの `outcome` は `misconfigured`）。WordPress には届かない |
| **バッチの呼び出しだけを止める** | Environment `production` の Secret `WP_RELAY_TOKEN` を消す | `WP_RELAY_URL` だけが残るので、バッチは起動時の検証（`startup` / `validation`）で失敗し、中継を呼ばない |

**GitHub の Secret を消すだけでは、第三者が持つトークンは無効にならない。** 中継は旧トークンを受け付け続けるので、漏えいの対処にはならない。

バッチの失敗メールも止めるときは `DAILY_ENABLED` を `false` にする。再開は、環境変数を登録して deploy.md 手順 8.5 で再デプロイし、Secret をそろえる（§8.6 の新しいトークンで）。

### 14.2 wp_fetch の失敗の切り分け

バッチのログには `{"step":"wp_fetch","kind":"network"}` までしか出ない（公開リポジトリのログに状態の詳細を出さない設計）。原因は Vercel の `takatsu-connect-wp-relay` のログで見る。1 リクエスト 1 行で、`outcome`、`status`、`duration_ms` が出る。

- **失敗の通知が来たら早めに見る。** Vercel のログの保持期間は未確認で、翌日に材料が残っていることを前提にしている。
- `status` だけでは判断しない。中継の 401 と上流の 401 は状態コードでは区別できないので、`outcome` を見る。
- 確認のために WordPress へ問い合わせない。ログと設定で判断する（ADR 0011 §7）。

| `outcome` | `status` | 意味 | 対処 |
| --- | --- | --- | --- |
| `unauthorized` | 401 | GitHub と Vercel のトークンの不一致（ローテーションの途中など）、または第三者の要求 | バッチの時刻に対応する行なら §8.6 でそろえる。覚えのない行が大量なら §9.4 |
| `misconfigured` | 401 | Vercel の環境変数が未設定か空 | 環境変数を登録して再デプロイする（deploy.md 手順 8.5） |
| `invalid` | 400 | バッチの要求が許可リストに合わない（`_fields` やパラメータの変更と中継の食い違い） | コードを直す。`contracts/constants.json` と中継の許可リストを突き合わせ、中継もデプロイする |
| `upstream_status` | 3xx、4xx、5xx | 上流の WordPress がその状態コードを返した | 下の「出口 IP が国外に振られた場合」。429、500、502、503、504 はバッチが再試行したうえでの失敗 |
| `too_large` | 413 | 本文が 4 MB を超えた | `WP_PER_PAGE` を下げる（コードの変更）。依頼者に報告する |
| `upstream_unreachable` | 502 | 上流に接続できない | 1 日だけなら翌日の実行を待つ（§2 の `network` と同じ） |
| `upstream_timeout` | 504 | 上流の応答待ちが 20 秒を超えた | 同上。続くなら対象サイトの状況を依頼者が確かめる。対象サイトの設定は変えない |
| 該当の行がない | ― | 中継に届いていない、または Vercel の基盤で止まった（`WP_RELAY_URL` の誤り、デプロイの不在など） | `WP_RELAY_URL` が production ドメインかを依頼者が確かめ、Vercel の状態とデプロイの一覧を見る |

起動の時点の失敗（`startup` / `validation`）は、`WP_RELAY_URL` と `WP_RELAY_TOKEN` の片方だけの登録や、URL の形の誤り（`https` でない、パスや末尾の `/` がある）を疑う。中継の設定を忘れて両方とも未設定のときは、直接接続になり、国外制限で `wp_fetch` の `network` になる。

**出口 IP が国外に振られた場合**:

- hnd1 の出口 IP が日本であり続ける保証は確認できていない（未確認）。そうなった場合の拒否の状態コードと本文の形も未確認で、ログには `upstream_status` と 3xx か 4xx の `status` が出ると見込む。
- 拒否が 200 の別の本文で返った場合は、`wp_fetch` の `validation` で止まる（`X-WP-TotalPages` がない。一覧が空なら件数の検査と削除の上限）。拒否の返り方は未確認。
- `wp_fetch` の失敗では DB は変わらない。BI は前回のデータのまま。記事の差分は前回成功の時刻から取るので、次に成功した実行で追いつく。1 日だけなら何もしなくてよい。
- **直接接続や別の経路に切り替えない。対象サイトの国外制限を緩めない**（依頼者の決定）。
- 連続して上流の拒否になるなら、固定の日本の IP を持つ経路を別の ADR で検討するよう依頼者に報告する。Fixed IP の可否は未確認。止まっている期間が 7 日を超えたら、直した後に §4 の backfill を流す（§2）。

### 14.3 使用量の点検

- 月 1 回、Vercel の `takatsu-connect-wp-relay` の関数の実行回数を見る。バッチが成功している日の目安は 1 日数十回（ADR 0011 の見込み。実測はまだない。最初の実行の後に実測で置き換える）。
- 大きく超えているときは、ログの `outcome` を見る。`unauthorized` が多いなら未認証の大量要求（WordPress には届かない）。`ok` が多く、バッチの実行で説明がつかないならトークンの漏えいを疑い、§9.4。
- Vercel Firewall のレート制限を `/api/relay` に掛けられるか、費用の上限や通知を設定できるか、Pro の追加費用の有無は未確認。
