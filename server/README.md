# TD オンライン対戦の中継サーバー

Cloudflare Workers + Durable Objects で動く WebSocket の中継サーバーです。

- 部屋名ごとに Durable Object が1つでき、最大2人をつなぎます（パスワードなし）。
- 試合を始める合図と共通の種を配り、戦況・送り込み・決着の知らせを相手に中継します。勝敗は先に届いた知らせで決まります。
- 誰からも **3分間** メッセージが来なければ、アラームで接続を閉じて部屋を消します。全員が退室したときもすぐに消えます。
- 部屋のルールは `src/roomLogic.ts`（Cloudflare に依存しない）にあり、ルートの `tests/tdVersus.test.ts` でテストしています。通信の形はゲーム側と共通の `../src/net/tdVersusProtocol.ts` です。

## ローカルで動かす

```bash
cd server
npm install
npm run dev        # ws://localhost:8787 で待ち受ける
```

ゲーム側の `npm run dev`（開発サーバー）は、何も設定しなければ `ws://localhost:8787` につなぎます。
ブラウザを2つ開いて同じ部屋名を入れると対戦できます。

## デプロイ（初回）

1. Cloudflare のアカウントを作る（無料プランで動きます）。
2. ログインしてデプロイする。

   ```bash
   cd server
   npm install
   npx wrangler login
   npm run deploy
   ```

   表示された URL（`https://exblocks-war-td-versus.<アカウント名>.workers.dev`）を控える。

3. GitHub のリポジトリの Settings → Secrets and variables → Actions → **Variables** に、
   `TD_VS_SERVER` = `wss://exblocks-war-td-versus.<アカウント名>.workers.dev` を追加する（`https://` ではなく `wss://`）。
4. main に push する（または Actions から「GitHub Pages デプロイ」を手動実行する）と、ゲームがこのサーバーにつながる。

## 設定

- `wrangler.toml` の `ALLOWED_ORIGINS` に、接続を許すサイトを書くと、ほかのサイトからの接続を断れます。
  例: `ALLOWED_ORIGINS = "https://takenoko117.github.io,http://localhost:5173"`（空なら制限しない）。
- 放置で消すまでの時間は `../src/net/tdVersusProtocol.ts` の `TD_VS_IDLE_MS` です。
