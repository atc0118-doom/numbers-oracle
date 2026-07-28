# NUMBERS ORACLE

ナンバーズ3・4の最新結果取得、候補生成、バックテスト的中率表示を行うNext.jsアプリです。

## Vercel公開手順

1. このZIPを解凍する
2. ZIP直下の全ファイルをGitHubリポジトリ最上位へアップロードする
3. VercelでそのリポジトリをImportする
4. Framework Presetは `Next.js`、Root Directoryは空欄のままDeployする
5. 必要に応じて環境変数 `CRON_SECRET` を設定する

独自のBuild Command、Output Directory、Install Commandは設定しないでください。Vercelの自動判定を使用します。

## 修正内容

- Vercelが安全上ブロックする可能性のある古いNext.js 15.2.4を15.5.21へ更新
- `next.config.ts` を互換性の高い `next.config.mjs` に変更
- React DOMの型定義を追加
- API RouteをNode.js Runtimeへ固定
- 公式サイト取得に8秒タイムアウトを追加

## 注意

表示される的中率は過去データによるバックテスト参考値で、将来の当せんを保証しません。
