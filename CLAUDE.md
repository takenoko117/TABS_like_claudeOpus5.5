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

- **2D のアイコンはできるだけ使わない**（平たい絵は安っぽく見えるため）。ユニット・施設・レリック・ゴールドなど 3D モデルがあるものは、`src/render/UnitPreviews.ts` で**ボクセルモデルそのもの**を表示する（`data-unit-preview="兵種ID"` / `data-prop-preview` に `<canvas>` を入れた要素を置き、画面を描いたあと `UnitPreviews.bind`、毎フレーム `update` を呼ぶ）。`ui/UnitIcons.ts` の `getUnitIconSvg` などの 2D の絵は、WebGL が使えないときの下敷きにだけ使う。どうしても小さな記号が要るとき（ボタンの印・数字の横の記号など）だけ、下の `vx()` を使う。
- 説明は文字より絵で。UI の絵は `src/ui/VoxelIcons.ts` の `vx('名前')` だけを使い、**絵文字は使わない**（`tests/voxelIcons.test.ts` が検出する）。新しい絵は `SPRITES` に描き足し、`icons.html` で確認する。
- 色・縁・影・書体は `src/theme.css` のトークン（`--panel`・`--panel-edge`・`--bevel`・`--drop`・`--font-pixel` など）を使う。角丸とぼかした影は使わない。縁は 2px、ボタンは面取り＋段差の影で、押すと沈む。
- 見出し・ボタン・数字はドットフォント（`var(--font-pixel)`、太さは 400 のみ）、長い説明文は `var(--font-ui)`。

### ボクセルの粒度（細かすぎるボクセルは使わない）

このゲームの味は「大きめのブロックを積んだ質感」（マインクラフトのような粗さ）と、被弾でブロックが崩れ落ちる部位破壊の演出にある。ボクセルを細かくして滑らかな彫刻にすると、従来のユニットと並んだときに浮き、崩壊の破片も粉のようになって見えなくなる。ユニットのモデルは次を守る（数値は `src/render/VoxelScaleRules.ts`、全兵種を `tests/voxelScale.test.ts` が検査する）。

- 1 ボクセルの寸法は兵士と同じ **0.04 前後**（`VOXEL_SIZE_STANDARD`）。`makeTemplate` / `Sculpt.spec` に渡す値は **0.034 以上**（`VOXEL_SIZE_MIN`）。
- 大きいユニットは scale で拡大されるので、ボクセルも一緒に大きくなるのが正しい（巨人・使徒と同じ）。**大きいからといって細かく刻まない。**
- 画面上の寸法（テンプレートの寸法 × scale）は **0.03 以上**（`WORLD_VOXEL_SIZE_MIN`）。小さいユニットはボクセルを細かくせず、ボクセルの数を減らして小ささを出す。
- 目・模様・縁取りなどの細部は、ボクセルを細かくせず色分け（塗り）で描く。1 ボクセルで表せない細部は省く。
- テストの例外リスト `LEGACY_FINE_VOXEL_UNITS` はルール以前のモデル用。**新しいモデルを足さない。** 作り直したら外す。

# 作業ルール

## 実装後の GitHub への push

- コードやファイルを変更する実装作業が終わったら、ユーザーに確認せず、自動でコミットして main に push する。
- push の前に `npm test` と `npm run typecheck` を実行し、両方通った場合だけ push する。失敗したら push せず、内容を報告する。
- コミットするのは今回の作業で変更したファイルだけ。`git add -A` は使わず、ファイルを指定して追加する。
- force push はしない。push が拒否されたら止めて報告する。
- 質問への回答や調査だけで、ファイルを変更していない場合は push しない。

## ブラウザでの動作確認

- ブラウザでの動作確認は基本的にユーザーに任せる（トークンの浪費を避けるため）。
- Claude がブラウザで確認する必要があると判断した場合は、実行前にユーザーの許可を得る。許可はその回の確認にのみ有効。
- 実装後の確認は、ブラウザを使わずに済むテストや型チェックなどで行い、未確認の点はユーザーに伝える。
