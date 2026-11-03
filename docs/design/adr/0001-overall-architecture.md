# ADR 0001: 全体構成（GitHub Actions 日次バッチ → Supabase → Vercel）

- 状態: 承認済み（依頼者の決定を記録。2026-11-03）
- 更新日: 2026-11-03
- 関係: 00_overview.md §5、NFR-01、NFR-11、NFR-42、NFR-60、NFR-70、FR-70、00_architecture.md

## 文脈

- 高津コネクト（WordPress、月 3,000〜7,700 PV、記事 225 本、著者 21 人）のアクセス集計を、運営者とライターがログインなしで見られる BI にする。
- データは GA4 Data API と WP REST API から日次で取り、GA4 側の保持期間に依存せず自前で蓄積する（NFR-50、NFR-51）。
- 制約: 無料枠で動かす（NFR-60）、無人運用（NFR-70）、public リポジトリ、ログインなし、公開データの規則（NFR-30〜NFR-45）。
- 依頼者は 2026-11-03 に「GitHub Actions で日次実行して Supabase に格納し、Vercel の BI が Supabase をサーバー側から読む」構成を決定した。本 ADR はその決定を記録し、設計時に比較した代替案を残す。

## 選択肢

| 案 | 取得・集計 | 蓄積 | 表示 | 月額 | 運用負荷 |
| --- | --- | --- | --- | --- | --- |
| A（採用） | GitHub Actions の cron（日 1 回） | Supabase Free（Postgres） | Vercel Hobby の静的サイト（日次再ビルド） | 0 円 | cron の 60 日停止対策、3 サービスのアカウント管理 |
| B | Vercel Cron + Vercel Functions | Supabase Free | Vercel（同じプロジェクト） | 0 円 | Hobby の Function は 300 秒上限でバックフィルに足りない。cron は 1 日 1 回に制限。秘密が Vercel に集まる |
| C | Supabase Edge Functions + pg_cron | Supabase Free | Vercel | 0 円 | Edge Functions の実行時間と GA4 クライアントの互換（Deno）の確認が要る。デバッグが Actions より難しい |
| D | 自前の VPS や常駐サーバー | 任意 | 任意 | 数百〜千円 | OS・パッチ・監視の運用が発生。要件の規模に対して過大 |
| E | GA4 を BI から直接読む（蓄積なし。Looker Studio など） | なし | Looker Studio / 直接 API | 0 円 | 蓄積・伏せ値・除外の統制ができず NFR-33、NFR-43、NFR-51 を満たせない。ログインなしで公開もしにくい |

## 決定

案 A。

- 取得・集計・格納は GitHub Actions の日次バッチ。Web サービスとして公開しない。Secrets は Actions にだけ置く。
- 蓄積は Supabase（Postgres）。全表 RLS、公開ビュー（`pub_*`）だけを anon に select 許可（02_data_model.md）。
- 表示は Vercel 上の Next.js 静的サイト。バッチの終わりに Deploy Hook で再ビルドし、ビルド時だけ Supabase（anon）を読む（ADR 0006）。ブラウザから Supabase に接続しない（NFR-42）。
- 実行時にサーバーが動く部分（API、Functions）を作らない。

## 結果

- 良い点: 月額 0 円。実行時のサーバーがなく、攻撃面が静的ファイルと Supabase の公開ビューに限られる。失敗しても前回のビルドが残る（NFR-90）。Actions のログで実行の経緯を追える。
- 引き受ける点: public リポジトリの cron は 60 日無活動で止まる（D-07、03 §12 の heartbeat）。cron の遅延（2 本目の cron で保険）。3 つのサービス（GitHub、Supabase、Vercel）のアカウントと無料枠の見守り（docs/operations/ で記録）。Vercel Hobby は非商用・個人利用向け（依頼者が了承）。
- 影響: 04_api.md は HTTP の API ではなく「公開ビューとページに埋め込む JSON の契約」を書く。05_screens.md の操作（期間切り替え、フィルタ、並べ替え、CSV）はすべてクライアント側。
