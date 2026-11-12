# TD オンライン対戦の中継サーバー

Cloudflare Workers + Durable Objects で動く WebSocket の中継サーバーです。

- 部屋名ごとに Durable Object が1つでき、最大2人をつなぎます（パスワードなし）。部屋を作った人が席 0（ホスト・青）、一覧から入った人が席 1（ゲスト・赤）です。
  - 接続先は `wss://<worker>/room/<部屋名>?intent=create|join`。`create` は人がいる部屋なら断り（閉じるコード 4002）、`join` は空の部屋なら断ります（4003）。
- 募集中の部屋（1人だけで試合中でない部屋）の一覧は `GET https://<worker>/rooms` で取れます。一覧は 1 つの Durable Object（`LobbyObject`）が持ち、各部屋が人数の変化と、募集中の間は30秒ごとに「まだある」ことを知らせます。知らせが途切れた部屋は約3分半で一覧から消えます。
- 試合を始める合図と共通の種を配り、各ターンの操作・戦況のハッシュ・決着の知らせを相手に中継します（対面型のロックステップ。戦場の計算は両方のブラウザが行います）。勝敗は先に届いた知らせで決まります。
- 試合中は各プレイヤーが 0.1 秒ごとに操作を送るので、1 試合（10 分）で約 1 万 2 千通のメッセージを受けます（無料プランでも1日100試合程度は収まる目安）。
- 誰からも **3分間** メッセージが来なければ、アラームで接続を閉じて部屋を消します。全員が退室したときもすぐに消えます。
- 部屋のルールは `src/roomLogic.ts`、一覧のルールは `src/roomDirectory.ts`（どちらも Cloudflare に依存しない）にあり、ルートの `tests/tdVersus.test.ts` でテストしています。通信の形はゲーム側と共通の `../src/net/tdVersusProtocol.ts` です。

## ローカルで動かす

```bash
cd server
npm install
npm run dev        # ws://localhost:8787 で待ち受ける
```

ゲーム側の `npm run dev`（開発サーバー）は、何も設定しなければ `ws://localhost:8787` につなぎます。
ブラウザを2つ開き、片方で部屋を作って、もう片方で一覧からその部屋を押すと対戦できます。

> 部屋の一覧（`LobbyObject`）を追加したため、`wrangler.toml` に移行 `v2` があります。すでにデプロイ済みのサーバーも `npm run deploy` をやり直してください。

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
