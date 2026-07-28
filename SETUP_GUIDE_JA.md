# NUMBERS ORACLE V7 更新手順（V6.5 → V7）

## 1. Supabaseを先に更新

Supabase → SQL Editor → New query を開き、`supabase-v7-migration.sql` の全文を貼ってRunします。

成功後、`forecasts`テーブルに `model_version` 列が追加されます。既存データには `LEGACY` が入ります。既存実績は削除されません。

V7では `model` に `random` が追加されます。また一意制約は `game + target_round + model + model_version` に変わるため、将来アルゴリズムを変更しても旧モデル予想を上書きしません。

## 2. GitHubをV7で上書き

ZIP内のファイルを現在のnumbers-oracleリポジトリへ上書きします。

V7では不要になった `app/api/cron/route.ts` は削除しています。Cronは次の2本だけです。

- `/api/cron/numbers3`
- `/api/cron/numbers4`

## 3. Vercel

環境変数は変更不要です。GitHubのコミット後、自動デプロイが `Ready` になるまで待ちます。

## 4. 初回V7同期

Vercel → Settings → Cron Jobs からNumbers3とNumbers4を各1回Runします。

V7のCron成功後、Supabase `forecasts` には次回について4モデルが保存されます。

- statistical
- ai
- hybrid
- random

## 5. サイト確認

「予想・比較」で4モデルが表示され、4-MODEL BACKTEST BENCHMARKにRANDOMが出れば成功です。

「公開実績」の `LIVE HEAD-TO-HEAD vs RANDOM` は、V7予想の対象回が実際に抽せん・照合されてから数字が入り始めます。過去のV6.5成績をRANDOMとの比較へ無理に混ぜません。

## 6. エラー時

Cronが500の場合はVercel Runtime Logsを確認します。V6.5同様、V7もstageログを出します。

- `stage=history`
- `stage=settle`
- `stage=predict`
- `stage=forecast`
- `stage=backtest`
- `stage=cache`
