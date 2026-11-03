# access-analyzer — 高津コネクト アクセス解析 BI

## プロジェクト概要
WordPress で運営する「高津コネクト」(https://takatsu-connect.com/) のアクセス数などを可視化する Web の BI サービスを作る。
工程は 要件定義 → 設計 → 構築 → デプロイ の順に進め、各工程の成果物は docs/ に Markdown で残す。

## 対象サイトについて分かっていること（2026-11-03 にトップページの HTML から確認）
- WordPress 7.1.4。テーマは Snow Monkey、子テーマ takatsuconnect。
- 計測タグは GA4 の gtag.js（測定 ID: G-79CFGF83VT）。Jetpack Stats、WP Statistics、Matomo、Site Kit はトップページから検出されなかった。
- WP REST API（/wp-json/wp/v2/）は公開されており、記事の ID・日付・URL などのメタデータを取得できる。
- 主なプラグイン: snow-monkey-blocks, snow-monkey-forms, wp-ulike, add-to-any, spotlight-social-photo-feeds, official-facebook-pixel。
- GA4 プロパティへのアクセス権、サーバーログの有無、ホスティング先は未確認。要件定義で確認する。

## 工程とエージェント
エージェント定義は .claude/agents/ にある。

| 工程 | エージェント | 主な成果物 |
| --- | --- | --- |
| 要件定義 | requirements-analyst | docs/requirements/ |
| 設計 | architect | docs/design/（ADR は docs/design/adr/） |
| 構築 | backend-engineer, frontend-engineer, qa-engineer, code-reviewer | src/, tests/ |
| デプロイ | devops-engineer | docs/operations/, .github/workflows/, Dockerfile など |
| 横断 | tech-writer | docs/ 全体, docs/glossary.md, README.md |
| 横断 | security-auditor | docs/security/audits/（監査報告。コードや設定は変更しない） |

## docs/ の構成
```
docs/
  requirements/   要件定義（概要、利用者、指標定義、データソース、機能・非機能要件、受入基準、未確定事項）
  design/         設計（構成、技術選定、データモデル、パイプライン、API、画面、セキュリティ、テスト計画、トレース表）
  design/adr/     Architecture Decision Record（NNNN-題名.md）
  operations/     環境、デプロイ手順、CI/CD、運用手順、監視、コスト
  security/audits/  セキュリティ監査の報告（YYYY-MM-DD-範囲.md）
  glossary.md     用語集
```

## 書き方の約束
- 文書は日本語で書く。各文書の冒頭に「状態（草案 / レビュー中 / 確定）」と「更新日」を書く。
- 要件には ID（指標 M-01、機能 FR-01、非機能 NFR-01 など）を付け、設計・テストから参照する。振り直さない。
- 未確定のことは推測で埋めず、docs/requirements/open_questions.md に質問として残す。
- 認証情報（GA4 のサービスアカウント鍵、API キーなど）はリポジトリに置かない。.env.example に項目名だけ書く。
- 本番環境と対象サイト（WordPress）を変更する操作は、依頼者の確認なしに実行しない。

## エージェントに依頼するときの約束
- 外部の事実（API 仕様、料金、制限）は、依頼する側が先に集めて、確認日と出典つきの事実票として渡す。
- 読ませるファイルは行範囲つきで列挙し、10 本以内・合計 15 万文字までを目安にする。
- 依頼に所要時間の上限を書き、終了時に所要時間とツール呼び出し回数を報告させる。
- セキュリティ監査（security-auditor）は、要件・設計の確定前、初回公開前、.github/workflows/ や Supabase の権限や認証に触れる変更のあと、定期点検のときに依頼する。致命的・高の指摘は Issue にして修正してから次の工程へ進む。

## 現在の状況
- 2026-11-03: リポジトリを初期化し、エージェント定義と本ファイルを追加。要件定義は未着手。
