# access-analyzer
高津コネクトのアクセス数を可視化する

## サービス情報

| 項目 | 内容 |
|---|---|
| サービス名 | 高津コネクト 読まれ方ノート |
| 段階 | 公開中 |
| GitHub リポジトリ | https://github.com/takatsu-connect/access-analyzer |
| URL | https://takatsu-connect-analyzer.vercel.app/ |
| インフラ | Vercel、Supabase、GitHub Actions、Google Analytics 4（Data API）、Google Analytics 4（BI の計測）、Google Cloud（Workload Identity Federation） |
| 説明 | WordPress で運営する地域メディア「高津コネクト」の記事がどう読まれているかを、ログインなしで誰でも見られる形で示す BI。運営者とライターが、記事・カテゴリ・曜日や時間帯ごとの読まれ方を確かめられる |
| 公開日 | 2026-11-09 |
| UptimeRobot monitor ID | なし |

## インフラ

| サービス | 用途 |
|---|---|
| Vercel | BI（`apps/web`）の配信と、高津コネクトの WP REST API を東京リージョンから読む中継（`apps/wp-relay`。ADR 0011） |
| Supabase | 集計値を格納する PostgreSQL。BI は公開ビューだけをサーバー側で読む |
| GitHub Actions | 日次バッチ（GA4 と WP から取得し、集計して Supabase に書き込む）、CI |
| Google Analytics 4（Data API） | アクセス数の取得元（測定 ID G-79CFGF83VT） |
| Google Analytics 4（BI の計測） | BI 自身の閲覧の計測（BI 用のプロパティ、測定 ID G-XQCE22FZ2R。本番だけ。ADR 0013） |
| Google Cloud（Workload Identity Federation） | GitHub Actions から GA4 Data API への認証（鍵を作らない。ADR 0002） |

対象サイト（https://takatsu-connect.com/）の WordPress の REST API から、記事の公開情報も読む。監視は外部のサービスを使わず、GitHub と Vercel の通知で行う（docs/operations/monitoring.md）。

## 文書

- 要件: docs/requirements/
- 設計: docs/design/（ADR は docs/design/adr/）
- 運用: docs/operations/
- BI の動かし方: apps/web/README.md
