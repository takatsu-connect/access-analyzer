# 監視

- 状態: 草案
- 更新日: 2026-11-07

この BI の監視は、外部の監視サービスを使わず、GitHub と Vercel の標準の通知、BI の画面の注記、`batch_run` の 3 つで行う（Q-12 確定: 失敗通知は GitHub のメール）。本番の BI と対象サイトに、外から定期的に問い合わせる監視（死活監視、スキャン）は置かない（NFR-72）。対処は runbook.md。

## 1. 何で気づくか

| 気づき方 | 何が分かるか | 届く先 | 設定 |
| --- | --- | --- | --- |
| GitHub Actions の失敗メール | `daily`、`backfill`、`publish_only`、`audit`、`heartbeat`、`ci` の失敗 | ワークフローを最後に変えた人、または schedule を有効にした人（GitHub の既定）。個人の Settings → Notifications → Actions で「Only notify for failed workflows」を選ぶ | 依頼者が個人の通知設定を確かめる（§5） |
| Vercel のビルド失敗の通知 | Deploy Hook と push のビルドの失敗（`check:build` の失敗を含む） | Vercel のアカウントの通知設定 | 依頼者が確かめる（§5） |
| BI の「更新が遅れています」 | ビルド時の `pub_meta` が古い、または今日 − 表示中の基準日 ≥ 3 日（ブラウザ側の判定。ワークフローが止まって再ビルドもされない場合も出る。03 §12、U-25） | 画面を見た人 | ― |
| `internal.batch_run` | 実行ごとの状態、失敗した工程、種別、件数、GA4 の割当 | SQL エディタで見る（§4） | ― |
| Dependabot の PR とアラート | 依存の更新と既知の脆弱性 | リポジトリの管理者 | 有効化済み（initial_setup.md §1） |
| 月 1 の目視（runbook.md §1） | schedule の停止（60 日無活動）、メールの見落とし | ― | ― |

- 失敗の通知が届かない失敗: schedule そのものが止まった（60 日無活動、Actions の障害）。これは「更新が遅れています」と月 1 の目視で気づく。
- `DAILY_ENABLED` が `true` でないとき、`daily.yml` のジョブは skipped になり、メールは届かない。本番化の後に誤って外していないかを月 1 で見る（Settings → Secrets and variables → Actions → Variables）。

## 2. 監視項目と確認の頻度

| 項目 | 正常 | しきい値 / 異常 | 確認の頻度 | 対処 |
| --- | --- | --- | --- | --- |
| `daily` の結果 | 毎日 success | failed | メールが来たとき | runbook.md §2 |
| データの日付 | BI の「◯月◯日までのデータ」が前日 | 2 日以上古い | 任意 | runbook.md §2、§3 |
| 所要時間 | daily 2〜4 分、backfill 6〜8 分（03 §2、§10） | daily が 15 分、backfill が 40 分を超える（上限は 30 分と 60 分） | 月 1 | WP と GA4 の待ちが増えていないかを件数で見る |
| GA4 の割当 | 通常日 約 490 トークン、backfill 約 5,200（03 §11） | 見込みの 3 倍を超える | 初回の backfill と最初の 1 週間、以後は月 1 | runbook.md §7 |
| `posts_late_seen` | 0 | 1 以上 | 失敗のない日でも、気づいたとき | runbook.md §5 |
| `ga4_missing_days`、`ga4_unknown_device_rows` | 0 | 1 以上が続く | 月 1 | GA4 の側の変化を疑う。続くなら Issue |
| `audit` | 週 1 で success | failed | メールが来たとき | runbook.md §12 |
| Vercel のビルド | 毎日 1 回（Deploy Hook）+ push ごと | 失敗 | 通知が来たとき | runbook.md §3 |
| Vercel の Hobby の使用量 | 上限内（デプロイ 1 日 100 回など。06 §2.4） | 使用量の警告のメール | 月 1 | Deploy Hook の漏えいを疑う（runbook.md §9.2） |
| Supabase の容量 | Free の上限内 | 使用量の警告 | 月 1 | 漏えいを疑う（runbook.md §9.1） |
| CA と証明書の期限 | CA 2031-04-26、サーバー証明書 2030-03-11 | 期限の 3 か月前 | 2030-01 | runbook.md §11 |

## 3. ログの見方

- Actions のログは誰でも読める（public リポジトリ）。バッチが出すのは JSON の 1 行ずつで、工程の開始・終了、件数、所要時間、エラーの種別だけ（03 §15）。

| 行の形 | 意味 |
| --- | --- |
| `{"step":"wp_fetch","event":"start"}` / `"end"` | 工程の開始と終了 |
| `{"step":"ga4_daily","count":"ga4_tokens","n":123}` | 件数（GA4 のトークン、残量、WP のリクエスト数、取り込んだ記事数、書き込んだ行数、`posts_late_seen` など） |
| `{"step":"write","duration_ms":4567}` | 所要時間 |
| `{"step":"ga4_period","kind":"quota"}` | 失敗した工程と種別（`quota`、`auth`、`network`、`validation`、`db`、`unknown`） |

- 例外の本文、スタック、API の応答、記事の題名、著者名、URL、接続文字列は出ない。出ていたら設計の違反なので、その実行のログを消し（Actions の実行の「Delete all logs」）、security-auditor に報告する。秘密の値が含まれていれば runbook.md §9。
- ログの詳細度を上げる設定（`ACTIONS_STEP_DEBUG`、Re-run の「Enable debug logging」）を使わない（03 §15）。
- `ci.yml` の E2E が落ちたときは、成果物 `playwright-report`（7 日で消える。中身はフィクスチャの架空のデータ）を見る。
- Vercel のビルドログには、ビルド時の読み出しの件数だけが出る（06 §8）。

## 4. batch_run の見方

Supabase の SQL エディタで実行する（読むだけ。依頼者か運用担当が行う）。`counts` の値は件数だけで、秘密を含まない。結果を Issue に貼るときも件数と状態だけにする。

直近 14 回:

```sql
select started_at, finished_at, base_date, mode, status, failed_step, error_kind,
       counts->>'ga4_tokens' as ga4_tokens,
       counts->>'ga4_tokens_remaining_hour' as remaining_hour
from internal.batch_run
order by started_at desc
limit 14;
```

失敗の続き方（直近 30 日）:

```sql
select base_date, count(*) filter (where status = 'failed') as failed, count(*) filter (where status = 'success') as success
from internal.batch_run
where started_at > now() - interval '30 days'
group by base_date
order by base_date desc;
```

- `running` のまま 2 時間を超えた行は、次回の preflight が `failed` / `unknown` に直す（03 §1）。
- `publish_only` は行を書かない。`mode` が `daily` / `backfill` 以外（`manual`）の行の扱いはバッチのコードに従う。
- BI の公開ビュー `pub_batch_run` に出るのは状態と工程名と種別だけ（06 §8）。

## 5. 確認が要ること

1. schedule の失敗メールの宛先。GitHub の既定では、schedule のワークフローの通知はワークフローのファイルを最後に変えた人に届く（と理解しているが、この作業では公式文書で確かめていない）。依頼者が、本番化の後の最初の失敗（例: 手順 8 の前に誤って失敗させた実行）で届くかを確かめる。
2. Vercel のビルド失敗の通知の既定（Hobby）。
3. Supabase Free の使用量の警告がメールで届くか。
