# エクスブロックスウォー（EXBLOCKS WAR）

TABS 風の物理バトルシミュレーター。TypeScript + Vite + Three.js、物理は自前の Verlet 積分。ボクセルのラグドールを関節のばね（筋肉）で動かす。
main へ push すると GitHub Actions（`.github/workflows/deploy.yml`）で GitHub Pages に自動デプロイされる。

## コマンド

```bash
npm test                # vitest（ブラウザ不要。実装後の確認はこれと型チェックで行う）
npm run typecheck       # tsc --noEmit
npm run outline -- <ファイル> [絞り込み]   # クラス・メソッドの目次と行番号
npm run dev             # 開発サーバー（.claude/launch.json の "dev"、port 5173）
```

## コードの読み方（コンテキスト節約のため必ず守る）

ソースは約 6 万行あり、1000 行を超えるファイルが 10 本以上ある。**大きなファイルを頭から全部読まない。**

1. まず [docs/CODEMAP.md](docs/CODEMAP.md) で、どのファイルのどのメソッドを見るか当たりをつける。
2. `npm run outline -- <ファイル> [名前の一部]` か Grep で行番号を取る。
3. Read は `offset` / `limit` で必要な範囲（目安 200 行以内）だけ読む。
4. 特に次のファイルは全体を読まない: `render/VoxelModel.ts`（6800 行）、`style.css`（5400 行）、`game/GameApp.ts`（5200 行）、`units/Unit.ts`（3900 行）、`render/SceneView.ts`（3800 行）、`game/RogueliteMode.ts`（2500 行）、`game/ArcadeStages.ts`（2300 行）、`audio/SoundManager.ts`（1900 行）、`combat/CombatSystem.ts`（1600 行）。
5. `package-lock.json`・`dist/`・`node_modules/` は読まない。仕様書（ルート直下の `*_SPEC.md` など）は作業に関係するものだけ読む。
6. 広く探す必要があるときは Explore サブエージェントに任せ、結論だけ受け取る。

### インデックスの更新

- ファイルの追加・削除・分割、役割の大きな変化があったら、同じ作業の中で `docs/CODEMAP.md` を更新する。
- CODEMAP には行番号を書かない（すぐずれる）。メソッド名・定数名で書く。

## コーディング規約

- コード内のコメントはすべて日本語で書く。
- コミットメッセージは日本語。既存の形式に合わせ「TDモード: ○○を追加」のようにモード名を先頭に付ける。
- 計画・進捗報告も日本語。
- ゲームの仕組み（シミュレーション）は Three.js に依存させず、`tests/` から vitest で検証できるようにする。数値の変更や新ルールにはテストを足す。
- 遊び方が変わる変更をしたら `README.md` も更新する。
- 新しいモードの数値は、各モードのファイル冒頭の定数（`TD_*`、`ROGUE_*` など）にまとめる。

## デザイン規約（ボクセルのブロック UI）

- 説明は文字より絵で。UI の絵は `src/ui/VoxelIcons.ts` の `vx('名前')` だけを使い、**絵文字は使わない**（`tests/voxelIcons.test.ts` が検出する）。新しい絵は `SPRITES` に描き足し、`icons.html` で確認する。
- 色・縁・影・書体は `src/theme.css` のトークン（`--panel`・`--panel-edge`・`--bevel`・`--drop`・`--font-pixel` など）を使う。角丸とぼかした影は使わない。縁は 2px、ボタンは面取り＋段差の影で、押すと沈む。
- 見出し・ボタン・数字はドットフォント（`var(--font-pixel)`、太さは 400 のみ）、長い説明文は `var(--font-ui)`。

# 作業ルール

## 実装後の GitHub への push 確認

- コードやファイルを変更する実装作業が終わったら、ターンを終える前に必ず「GitHub の main に push するか」をユーザーに尋ねる。
- ユーザーが承認するまで main へ push しない。承認はその回の push にのみ有効で、次の作業では改めて尋ねる。
- 質問への回答や調査だけで、ファイルを変更していない場合は尋ねなくてよい。

## ブラウザでの動作確認

- ブラウザでの動作確認は基本的にユーザーに任せる（トークンの浪費を避けるため）。
- Claude がブラウザで確認する必要があると判断した場合は、実行前にユーザーの許可を得る。許可はその回の確認にのみ有効。
- 実装後の確認は、ブラウザを使わずに済むテストや型チェックなどで行い、未確認の点はユーザーに伝える。
