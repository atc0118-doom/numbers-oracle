# NUMBERS ORACLE V6 導入手順

## 事前に用意するもの
- GitHubアカウント
- Vercelアカウント
- Supabaseアカウント
- このZIPを解凍できるPC

## A. Supabaseを更新する
1. Supabaseへログインします。
2. V5で使っているプロジェクトを開きます。新規導入の場合は新しいProjectを作成します。
3. 左メニューの **SQL Editor** を開きます。
4. **New query** を押します。
5. ZIP内の `supabase.sql` をメモ帳などで開き、全文をコピーします。
6. SQL Editorへ貼り付けて **Run** を押します。
7. `Success. No rows returned` と表示されれば完了です。
8. 左メニューの **Table Editor → forecasts** を開き、次の列があることを確認します。
   - target_date
   - purchase_type
   - stake_yen
   - return_yen
   - roi_percent

既存のV5データは削除しません。`add column if not exists` により不足列だけ追加します。

## B. Supabaseの接続情報を確認する
1. Supabaseの **Project Settings** を開きます。
2. **API** または **Data API** を開きます。
3. `Project URL` をコピーします。これが `SUPABASE_URL` です。
4. API Keysから `service_role` のSecret Keyをコピーします。これが `SUPABASE_SERVICE_ROLE_KEY` です。
5. service_roleキーは他人へ送らず、GitHubにも書き込まないでください。

## C. CRON_SECRETを作る
英数字を混ぜた長い文字列を自分で作ります。例の文字列をそのまま使わないでください。

例：`oracle-v6-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

## D. GitHubをV6へ更新する
1. ZIPを解凍します。
2. GitHubで現在Vercelに接続しているリポジトリを開きます。
3. V5のファイルをV6の同名ファイルで上書きします。
4. 特に次がアップロードされていることを確認します。
   - `app/`
   - `lib/`
   - `package.json`
   - `tsconfig.json`
   - `next.config.mjs`
   - `vercel.json`
   - `supabase.sql`
5. `node_modules` はアップロードしません。
6. Commit messageは `Upgrade to V6 hardened edition` などで構いません。

GitHubのWeb画面でフォルダ上書きが難しい場合は、既存ファイルを削除してからZIP内のファイルをまとめてドラッグしてください。

## E. Vercel環境変数を登録する
1. Vercelで対象Projectを開きます。
2. **Settings → Environment Variables** を開きます。
3. 以下を1件ずつ登録します。

### SUPABASE_URL
Value：SupabaseのProject URL

### SUPABASE_SERVICE_ROLE_KEY
Value：Supabaseのservice_role Secret Key

### CRON_SECRET
Value：自分で作成した長いランダム文字列

4. Environmentは最低でも **Production** を選びます。Previewでも確認する場合はPreviewにも適用します。
5. 保存後、必ず再デプロイします。環境変数は保存しただけでは過去のDeploymentへ反映されません。

## F. 再デプロイする
1. Vercelの **Deployments** を開きます。
2.最新Deploymentのメニューから **Redeploy** を選びます。
3. Build Logsでエラーがないか確認します。
4. `Ready` になったら公開URLを開きます。

## G. 動作確認
### 予想API
公開URLの末尾へ以下を付けます。
`/api/data?game=numbers4`

JSONが表示され、次を確認します。
- `status: official`
- `targetDate` が入っている
- `accuracy.hybrid` がある
- `predictions.hybrid` が10件ある

### 画面
トップページで以下を確認します。
- `V6` 表示
- NEXT TARGETの下に日付表示
- HYBRID BACKTESTが独立表示
- 公開実績に投資額・回収額・ROI欄がある

## H. 初回Cronを実行する
通常は平日21:15 JSTに自動実行されます。初回だけすぐ保存したい場合はVercelのCron画面からRunします。

1. Vercel Projectの **Settings → Cron Jobs** またはCron一覧を開きます。
2. `/api/cron` を選び **Run** を押します。
3. Function Logsで `ok: true` を確認します。
4. SupabaseのTable Editorで、Numbers3とNumbers4について3モデルずつ、合計6行が追加されたことを確認します。

ブラウザで `/api/cron` を直接開くと、CRON_SECRET認証により401になる場合があります。これは正常です。

## I. 翌抽せん後の確認
次のCron実行後、前回の `pending` が `settled` へ変わります。
- winning_number：当せん番号
- straight_hit：ストレート一致
- box_hit：並び替え一致
- best_digit_match：同じ位置で一致した最大桁数
- stake_yen：10口なら2,000円
- return_yen：公式払戻金を取得できた場合の回収額
- roi_percent：回収額が取得できた場合のみ計算

## 注意事項
- target_dateは土日を除外した推定日です。祝日や発売日変更までは自動判定しません。
- ROIは10口すべてをストレートで各200円購入した仮定です。
- 当せんを保証するものではありません。
- 公式サイトの構造が大幅に変わった場合、取得処理の更新が必要です。
