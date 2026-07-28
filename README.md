# NUMBERS ORACLE V6.3

V6.2のキャッシュ構成を維持しつつ、最新結果ソースの更新遅延でNEXT TARGETが過去日付になる問題を修正。楽天銀行の月別履歴を主データとし、最新1回のみ公開速報で補完可能。JST基準で結果が古い場合は誤った予想を保存せず更新待ちにする。

# NUMBERS ORACLE V6.2 — CACHED RUNTIME

V6.2はVercelの60秒タイムアウト対策版です。

## 変更点
- `/api/data` は外部サイトへアクセスせず、Supabaseの `oracle_cache` だけを読むため高速です。
- 外部履歴取得・予想生成・バックテストはCron同期時だけ実行します。
- Numbers3 / Numbers4 のCronを10分ずらして分離しました。
- 履歴取得は楽天銀行の月別当せん番号案内を最大12ページ並列取得します。
- AI/HybridバックテストはCron時間内に収めるため直近24回をウォークフォワード検証します。
- 不要ファイル `lib/ai.ts.tmp`, `lib/vercel.json`, `next.config.ts`, `tsconfig.tsbuildinfo` を削除しました。

## 初回アップデート時
1. Supabase SQL Editorで `supabase.sql` を実行（`oracle_cache`を追加）。
2. GitHubをこの内容で上書き。
3. VercelデプロイがReadyになったら、CronをNumbers3/Numbers4それぞれ一度実行。
4. `oracle_cache` に2行できれば完了。

環境変数は既存の `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` をそのまま使います。
