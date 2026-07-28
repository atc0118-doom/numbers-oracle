# NUMBERS ORACLE V6.4 更新手順

## 1. Supabase
既存プロジェクトの SQL Editor で `supabase.sql` を実行してください。
V6.4で新しく `oracle_cache` テーブルが追加されます。既存の `forecasts` データは削除しません。

成功後、Database > Tables に以下があればOKです。
- forecasts
- oracle_cache

## 2. GitHub
このZIPの中身で現在のリポジトリを上書きしてください。
旧ファイルは残さず、ZIPに存在しない不要ファイルも削除してください。

削除対象例:
- lib/ai.ts.tmp
- lib/vercel.json
- next.config.ts
- tsconfig.tsbuildinfo
- lib/seed.ts（残っている場合）

## 3. Vercel
環境変数は既存のままです。
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- CRON_SECRET

GitHubへコミットすると自動デプロイされます。StatusがReadyになることを確認してください。

## 4. 初回同期
V6.4では画面を開いても外部データ取得を行いません。
Cronが以下を実行してSupabaseへ計算済み結果を保存します。
- /api/cron/numbers3
- /api/cron/numbers4

設定時刻はUTC 12時台（日本時間21時台）です。
初回Cron実行前は画面に「初回同期がまだです」と表示されます。

VercelのCron Jobs画面から手動実行できる場合は、Numbers3 / Numbers4を各1回実行してください。

## 5. 正常確認
Supabase > Table Editor > oracle_cache に2行（numbers3 / numbers4）が入れば同期成功です。
その後トップページを再読込すると、キャッシュ済み予想が数秒以内に表示されます。
