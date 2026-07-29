# NUMBERS ORACLE V7.1 — RANDOM BASELINE VERIFICATION

V7の目的は「AIが当たる」と主張することではなく、**AI / 統計 / HYBRID が完全なランダム基準より実際に優位かを、同じ条件で検証すること**です。

## V7の4モデル

- `STATISTICAL` — 統計モデル。バックテストでは各検証時点の過去データだけで重みを選び直します。
- `AI` — 多クラスロジスティック回帰。
- `HYBRID` — 統計45% + AI55%。バックテストも実運用と同じ構成です。
- `RANDOM` — 当せん履歴を使わず、対象回だけを種にした再現可能な擬似乱数10口。比較基準です。

## モデルバージョン

V7から各予想に`model_version`を保存します。アルゴリズムを将来変更しても旧モデルの成績と混ぜません。

- `STAT-7.0-WF`
- `AI-7.0-LOGREG`
- `HYBRID-7.0-45_55`
- `RANDOM-7.0-SEEDED`

## 公平な比較

バックテストは4モデルとも同じ対象回、同じ10口で比較します。ただし短いバックテストの差は偶然で簡単に変動します。V7の主評価は、抽せん前にSupabaseへ保存された**公開後実績のpaired comparison**です。

公開実績では、同じ対象回に存在するV7モデルとRANDOMだけをペアにして平均桁一致、ストレート差、BOX差を比較します。

## 更新時に必要なこと

V6.5から更新する場合、GitHubへV7を上書きする前後にSupabase SQL Editorで `supabase-v7-migration.sql` を一度実行してください。

環境変数はV6.5と同じです。

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CRON_SECRET`

その後VercelがReadyになったらNumbers3 / Numbers4のCronを各1回Runしてください。

## 注意

抽せんはランダム性が非常に高く、過去データから将来の当せんを保証するものではありません。V7の目的は予想モデルの優位性の有無を透明に検証することです。


## V7.1 fix
Supabase の新しい `sb_secret_...` API key は `apikey` ヘッダーだけで送信します。Legacy `service_role` JWT (`eyJ...`) の場合のみ Authorization Bearer を併用します。

## V7.2 変更点（コードレビュー対応）

環境変数・Supabaseスキーマの変更はありません。上書きしてそのままデプロイできます。

- **可読性リファクタ**：`predict.ts` / `ai.ts` / `official.ts` / `sync.ts` / `accuracy.ts` / `random.ts` / `storage.ts` を1行詰め込みスタイルから展開し、マジックナンバーに名前を付けました。計算ロジック自体は変更していません（結果は同じになるはずです）。
- **祝日対応**：`expectedLatestDrawDate` / `nextDrawDate` が土日に加えて日本の祝日（holidays-jpデータセット）を考慮するようになりました。祝日APIが取得できない場合は従来の土日のみ判定に自動フォールバックします。
- **バックテスト件数を緩和**：`MAX_BACKTEST_ROUNDS` を8→16に。既に取得済みの履歴を使い回すだけなのでスクレイピング量は増えません。
- **`dataQuality`判定のバグ修正**：`draws.every(d=>d.source==='official')` が常にfalseになっていた（`Draw.source`は実際には`bank-fallback`/`public-fallback`/`cache`のいずれかしか入らない）ため、常に`reference`表示になっていました。正しい値と比較するよう修正しました。UI上では現状未使用ですが、今後使う場合のために直しています。
- **`any`型の除去**：`OracleCacheRow.payload`（および`saveOracleCache`の引数）が`any`だったのを`OracleCachePayload`という具体的な型に置き換えました。

### 未解決のトレードオフ（意図的に変更していません）

- **スクレイピング先への依存**：楽天銀行・loto-life.netの正規表現HTMLパースは変わっていません。取得月数を増やせばバックテストのサンプルを増やせますが、その分スクレイピング負荷も増えるトレードオフがあるため、今回は取得月数を増やさず、既存データの再利用（バックテスト件数緩和）だけに留めています。中長期的な解決策は、Supabase側に取得済みの回号を蓄積して差分だけ取得する設計です。
