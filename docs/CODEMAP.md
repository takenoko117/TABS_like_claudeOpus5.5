# コードマップ（エージェント向けインデックス）

ソースは約 6 万行あり、全部読むとコンテキストを使い切る。**まずこの表で当たりをつけ、`npm run outline` で行番号を取り、必要な範囲だけ読む。**
行番号はすぐずれるので、この文書には書かない（行数は 2026-11-12 時点の目安）。

```bash
npm run outline -- src/game/GameApp.ts          # クラス・メソッドの目次と行番号
npm run outline -- src/game/GameApp.ts rogue    # 名前に rogue を含むものだけ
npm run outline -- src/style.css                # CSS の見出しコメント
npm run outline -- src                          # 全ファイルの行数
```

## 全体の流れ

`index.html` → `src/main.ts`（`GameApp` を作って `requestAnimationFrame` で `tick`）→ `GameApp` が UI・モード・`Battle`・`SceneView` を束ねる。

- **シミュレーション**（Three.js 非依存。テストはここを叩く）: `Battle` が `PhysicsWorld`・`Unit`・`Facility`・`CombatSystem`・`FieldRuntime` を 1 ステップずつ進める。モード固有の処理は `BattleRules`（`RogueliteRules` / `TDBattleRules`）と `BattleOpening`（`RogueGateSequence`）を `Battle` に差し込む。
- **描画**: `SceneView` が毎フレーム `Battle` の状態を読んで Three.js に反映。兵士の見た目は `VoxelCharacterVisual`（`VoxelModel.ts`）。
- **UI**: ほとんどが `GameApp.ts` に直書きの DOM。TD モードの HUD だけ `ui/RealtimeTDHud.ts` に分離。CSS は `style.css`（全般・ローグライト）と `td.css`（TD）。
- **データ定義**: 兵種 `units/UnitTypes.ts`、施設・レリック・ゲート `facilities/FacilityTypes.ts`、アーケード面 `game/ArcadeStages.ts`。

## ファイル一覧

### src/game — モードとゲーム進行

| ファイル | 行 | 役割 |
| --- | --- | --- |
| `GameApp.ts` | 5416 | **巨大**。全モードの UI・入力・モード切替・戦闘の開始/終了・HUD。下の「GameApp の中身」を参照 |
| `Battle.ts` | 766 | 1 戦闘のシミュレーション本体。ユニット/施設の生成・削除、`step`、勝敗判定、ステージのハザード |
| `RogueliteMode.ts` | 2548 | **巨大**。ローグライトのルール・ラン・報酬・ゲート。下の「RogueliteMode の中身」を参照 |
| `RealtimeTDMode.ts` | 1188 | TD モード。定数（`TD_*`、対戦用は `TD_DUEL_*`）、ウェーブ・資金・経験値の計算関数、`TDRun`（1 陣営ぶんのラン状態。対戦では `team` で左右を反転し、画面操作は `request*` → `commandSink` → `execute` で反映。対戦の宝箱は `pendingChests` に積んで `requestChest` で開ける）、`TDBattleRules` |
| `TDDuel.ts` | 400 | TD オンライン対戦（対面型）。2 陣営の `TDDuel`（撃破の報酬・宝箱を積む・勝敗・ハッシュ）、`TDDuelBattleRules`、ロックステップ `TDLockstep`（ターンごとに両席の操作がそろってから進める。`slot = null` で観戦: 記録の読み込み `loadLog` と早送り） |
| `TDWildCamps.ts` | 250 | TD オンライン対戦の第三勢力（野生の魔物、team 2）。定数 `TD_WILD_*`（巣の配置 `TD_WILD_CAMPS`・報酬 `TD_WILD_KINDS`）、巣の管理 `TDWildCamps`（湧き・回復・倒した陣営の判定 `killReward`）。`TDDuel.wild` が持ち、魔物の縄張りの動きは `Unit.leash`（`Unit.thinkLeashed`） |
| `SimRandom.ts` | 39 | 戦場を進める間だけ `Math.random` を共通の種の乱数に差し替える（`withSimRandom`）。描画コールバックは `nativeRandomCallback` で元に戻す |
| `TDVersusSession.ts` | 256 | TD オンライン対戦の進行（部屋・準備・試合・決着・観戦 `spectating`）。試合中の操作は `match`（`TDLockstep`）へ回す。通信路を差し替えられ、DOM なしでテストできる |
| `TDTerrain.ts` | 148 | TD の地形を 2 分ごとに作り直す処理 |
| `RogueJackpot.ts` | 285 | 戦闘中の宝箱ドロップ判定とリール報酬（ローグライト・TD 共通） |
| `ArcadeStages.ts` | 2302 | アーケード全 40 面のデータ（`ARCADE_STAGES` が大半）と星評価・セーブ |
| `ChallengeMode.ts` | 384 | チャレンジモード（敵編成の生成、スコア、ベスト記録） |
| `VersusMode.ts` | 264 | 友人対戦の「ローカル対戦」（配置ゾーン、`VersusSession`）。「オンライン対戦」は TD の対戦（`TDDuel` など）を使う |
| `BattleStats.ts` / `DamageStats.ts` | 55 / 52 | リザルトの戦績集計 |
| `LineupStore.ts` | 69 | 編成の localStorage 保存 |
| `Settings.ts` | 110 | 設定の保存（音量・画質・演出の強さ `fxLevel`・画面の揺れ）・`AdaptiveQuality`（自動画質） |

### src/units — 兵士

| ファイル | 行 | 役割 |
| --- | --- | --- |
| `UnitTypes.ts` | 1139 | **全兵種のステータス定義** `UNIT_TYPES`、`UnitTypeId`、チーム色、カテゴリ |
| `Unit.ts` | 3860 | **巨大**。1 体の兵士（ラグドール＋筋肉＋AI＋攻撃）。下の「Unit の中身」を参照 |
| `Skeleton.ts` | 99 | 関節 `J` と骨の拘束定義 |
| `Mounting.ts` | 60 | 騎乗（乗り物と乗り手の組み合わせ） |
| `HayatoHead.ts` | 37 | 特殊兵種「はやと」の頭部の位置計算 |

### src/combat・src/physics・src/facilities

| ファイル | 行 | 役割 |
| --- | --- | --- |
| `combat/CombatSystem.ts` | 1552 | 当たり判定・ダメージ・投射物・爆発・雷・特殊技（使徒のビームなど） |
| `physics/PhysicsWorld.ts` | 573 | 自前 Verlet 物理（粒子・拘束・地面・障害物・壁） |
| `physics/Particle.ts` / `Constraint.ts` / `SpatialHash.ts` | 小 | 物理の部品 |
| `facilities/FacilityTypes.ts` | 443 | 施設・レリック・ゲートの定義と、レベル別の数値テーブル |
| `facilities/Facility.ts` | 662 | 施設の実体（兵舎・トーテム・砲台・ゲートの更新処理、`applyStatGate`） |

### src/field — ローグライト/TD の手続き生成フィールド（仕様: `FIELD_PROCGEN_SPEC.md`）

| ファイル | 行 | 役割 |
| --- | --- | --- |
| `FieldTypes.ts` | 180 | グリッド定数・地面/水の ID・`FieldLayout` |
| `FieldGenerator.ts` | 817 | バイオームごとの地形生成と検証 `generateField` |
| `FieldRuntime.ts` | 1340 | 戦闘中の地形（破壊・炎上・水流・溶岩・経路探索・ユニットの舵取り） |
| `FieldPathing.ts` | 213 | コストグリッドと距離場 |
| `PropBuilder.ts` | 453 | 木・家などの小物のボクセル形状 |
| `BiomeDefs.ts` | 192 | バイオームと特性の定義、ルート選択肢 |
| `FieldRng.ts` | 59 | 乱数・ノイズ |

### src/render — 描画（Three.js）

| ファイル | 行 | 役割 |
| --- | --- | --- |
| `VoxelModel.ts` | 6817 | **最大**。兵種ごとのボクセルモデル生成と `VoxelCharacterVisual`（見た目の同期・部位破壊）、施設モデル。下の「VoxelModel の中身」を参照 |
| `SceneView.ts` | 3758 | **巨大**。シーン・カメラ・入力・地形描画・エフェクト・HP バー・ローグライトのハート |
| `FieldRenderer.ts` | 446 | 手続き生成フィールドの描画 |
| `DamageOverlay.ts` | 242 | ダメージ数値の表示 |
| `UnitPreviews.ts` | 405 | カード上で動くユニットのミニプレビュー |
| `DragonModel.ts` / `HayatoHeadModel.ts` / `TanimonArmModel.ts` / `YamamuronAwakenedModel.ts` | 200〜640 | 特殊兵種の専用モデル |
| `DroppedChests.ts` / `JackpotChest3D.ts` / `JackpotReels3D.ts` / `JackpotIcons.ts` | 200〜470 | 宝箱とリールの 3D 演出 |
| `XpOrbs.ts` | 184 | TD の経験値オーブ |
| `EnergyGateVisual.ts` / `RewardVoxelModels.ts` / `TitleLogo3D.ts` / `FieldMinimap.ts` | 小 | ゲートの膜、報酬モデル、タイトルロゴ、ミニマップ画像 |

### src/fx — 演出の共通基盤（仕様: `FX_SPEC.md`）

ゲーム側は `SceneView.emitFx(cue, tier, pos)`（中で `FxDirector.emit`）で「何が・どのくらい（tier 0〜3）」だけを伝える。数値はすべて `FxCues.ts` の表と `FX_*` 定数。Three.js・DOM 非依存の部分は `tests/fx.test.ts`、性能と対戦の同期は `tests/fxPerf.test.ts`。

| ファイル | 役割 |
| --- | --- |
| `FxCues.ts` | 演出の表 `FX_CUES`（揺れ・キック・ズーム・ヒットストップ・スロー・フラッシュ・ユニットの白フラッシュ・音・クールダウン）、戦闘エフェクト→演出の対応 `FX_EFFECT_CUES`、強さの設定 `FX_LEVEL_SCALE`（full/reduced/minimal）、`FX_*` 定数 |
| `FxDirector.ts` | 演出の指揮役。`emit`（表と設定から値を決めて各チャンネルへ）、フラッシュの回数制限、撃破の連鎖 `registerKill`、`suppressed`（観戦の追いつき・タイトル）、`allowBattleStop`（1 人用だけ戦場ごと止める）と `battleScale` |
| `CameraFx.ts` | トラウマ式の揺れ（trauma² ＋なめらかなノイズ）・方向キック・ズームパンチ。`SceneView.renderFrame` が描画の間だけ足す |
| `TimeFx.ts` | ヒットストップ（描画ストップ／戦場ストップ）とスロー、止めたぶんを取り戻す `fxDt` |
| `BannerQueue.ts` | 告知の優先度キュー（割り込み・順番・まとめ） |
| `ScreenFx.ts` | 画面全体のフラッシュ（DOM 1 枚） |
| `FrameProbe.ts` | フレーム時間の計測。URL に `?perf=1` で画面の隅に表示（`GameApp.recordFrameProbe`） |
| `ui/BannerFx.ts` | 立体文字（VoxelText）の告知。TD の `RealtimeTDHud.announce` が使う |
| `ui/TweenNumber.ts` / `ui/LagBar.ts` / `ui/FloatText.ts` / `ui/dom.ts` | なめらかな数字（増減で緑/赤）・HP の遅延ゲージ・HUD 上の小さな数字・`retrigger`/`stagger` |
| `fx.css` | 演出の見た目（`index.html` から読み込む） |

TD 対戦への適用は `RealtimeTDHud.ts`（`updateCastleFx`・`updateClockFx`・`onKill`・`announceFinish`・`playResultFx`・出撃カードの `fx-saving`/`fx-ready`）。出撃の土煙・城の破片は `SceneView.spawnDeployFx`/`spawnCastleImpact`、ユニットの白フラッシュは `VoxelCharacterVisual.flashWhite`、効果音は `SoundManager.playFxCue`、BGM のテンポ・ダッキングは `MusicPlayer.setTempoScale`/`duck`。

### src/ui・src/audio

| ファイル | 行 | 役割 |
| --- | --- | --- |
| `ui/RealtimeTDHud.ts` | 1021 | TD モードの HUD 全部（上部バー・配置バー・強化 3 択・チュートリアル・結果） |
| `ui/TDVersusUi.ts` | 318 | TD オンライン対戦のロビー（ピクセルアートの見出しとルールのカード `RULE_CARDS`・部屋の作成・部屋の一覧 `renderVersusRoomList`〈募集中は入室、対戦中は観戦〉・席の色）・試合中の対戦パネル（相手の城・通信待ち・ずれ・観戦の追いつき）・リザルト（観戦は `renderVersusWatchResult`）の HTML |
| `ui/VoxelIcons.ts` | 600 | **UI の絵はすべてここ**（絵文字は使わない）。文字の並びで描いたドット絵を、正面・明るい上面・暗い側面・縁取りの「積み木」SVG にする `buildVoxelBody`、アイコン `vx(名前, クラス)`・陣営 `vxTeam`・星の評価 `vxStars`、`index.html` の `<i data-vx="名前">` を置き換える `hydrateVoxelIcons`（`main.ts` で呼ぶ）。一覧は開発用ページ `icons.html`（`src/iconGallery.ts`） |
| `ui/PixelArt.ts` | 190 | オンライン対戦のロビーの大きめの挿絵（城・兵士・剣・宝箱など）。描き方は `VoxelIcons.buildVoxelBody` と共通 |
| `ui/UnitIcons.ts` | 1093 | 兵種・施設の SVG アイコン（ほぼデータ） |
| `ui/JackpotRoulette.ts` / `JackpotRewardFx.ts` | 462 / 269 | 宝箱開封の進行と報酬演出 |
| `ui/UnitDetailHelper.ts` | 231 | 兵種詳細パネルの表示データ |
| `ui/VoxelText.ts` | 303 | 見出し文字をボクセル風に描く |
| `ui/WarRoomFx.ts` / `WarRoomIcons.ts` | 小 | ローグライト作戦室の演出とアイコン |
| `ui/TutorialGuide.ts` | 95 | 初回プレイの案内 |
| `audio/SoundManager.ts` | 1878 | 効果音（WebAudio で合成）。`playEffect` が大半 |
| `audio/MusicPlayer.ts` / `MusicPatterns.ts` | 小 | BGM |

### src/net・server — TD オンライン対戦の通信

| ファイル | 行 | 役割 |
| --- | --- | --- |
| `src/net/tdVersusProtocol.ts` | 233 | 通信メッセージの型・検証（試合中の操作 `TDDuelCommand`・ハッシュ・決着・観戦の `watch` と操作の記録 `TDVersusInputLog`）、部屋名の整形、部屋の一覧の行 `TDVersusRoomListing`（`status` 募集中/対戦中）と検証 `parseRoomList`、入室のしかた `TDVersusJoinIntent`（create/join/watch）、定数（放置で消すまでの `TD_VS_IDLE_MS`、一覧の取り直し間隔 `TD_VS_LIST_POLL_MS` など）。クライアントとサーバーで共用 |
| `src/net/TDVersusClient.ts` | 92 | WebSocket の接続（`open` に部屋を作る・一覧から入るの区別を付ける）と、募集中の部屋の一覧の取得 `fetchTDVersusRooms`。URL はビルド時の `VITE_TD_VS_SERVER`（未設定の開発時は `ws://localhost:8787`） |
| `server/src/roomLogic.ts` | 210 | 部屋のルール `TDVersusRoom`（入室〈作成・一覧からの入室の区別〉・一覧に出す情報 `listing`・準備・開始・操作とハッシュの中継・決着・放置判定・観戦 `watch`〈操作の記録を渡す〉）。席 0 がホスト。Cloudflare 非依存で `tests/tdVersus.test.ts` から検証 |
| `server/src/roomDirectory.ts` | 105 | 募集中の部屋の一覧 `RoomDirectory`（部屋からの知らせ・古い部屋の削除）と、知らせ直す判定 `shouldReport`。`tests/tdVersus.test.ts` から検証 |
| `server/src/index.ts` | 230 | Cloudflare Worker と Durable Object `VersusRoomObject`（部屋名ごとに 1 つ、アラームで放置部屋を消す）・`LobbyObject`（部屋の一覧、`GET /rooms`）。手順は `server/README.md` |

### その他

- `src/theme.css`: **デザインの土台**。色・面取り・段差の影・書体のトークン（`--panel`・`--bevel`・`--drop`・`--font-pixel` など）、アイコン `.vx` の大きさ、共通部品（`.vx-panel`・`.vx-key`・`.vx-legend`・`kbd`）、ボタンの「押すと沈む」動き。`style.css` の先頭で読み込む。各画面の CSS はここのトークンを使い、角丸・ぼかし影は使わない
- `src/style.css`（5450 行）: 全 UI。前半が共通 UI・スマホ対応・ダメージ数字、「ローグライト」見出し以降（全体の後ろ 6 割）がローグライト（作戦室・報酬・宝箱演出）。`npm run outline -- src/style.css` で見出しを確認する
- `src/td.css`（778 行）: TD モード（末尾近くにオンライン対戦のロビーと対戦パネル）
- `index.html`: 画面の DOM の骨組み（id 付き要素を `GameApp` が取得）
- `preview.html` + `src/preview.ts`: 兵種モデル単体の確認ページ（`?unit=&angle=&mode=`）
- `tests/*.test.ts`: vitest。ファイル名がほぼ対象モジュールに対応（`roguelite.test.ts` → `RogueliteMode.ts`、`realtimeTD.test.ts` → `RealtimeTDMode.ts` など）

## 巨大ファイルの中身（メソッド名で grep する）

### GameApp の中身（`src/game/GameApp.ts`）

メソッド名の接頭辞でモードが分かれている。`npm run outline -- src/game/GameApp.ts <接頭辞>` で絞り込める。

| 領域 | 主なメソッド |
| --- | --- |
| 初期化・UI 構築 | `constructor`, `buildUI`（巨大）, `bindSettingsPanel`, `bindCanvasInteraction` |
| タイトル・チュートリアル | `showTitleScreen`, `leaveTitleScreen`, `enterPlayStyle`, `startTutorial` |
| 配置（全モード共通） | `checkPlacement`, `placeAt`, `spawnRecord(s)`, `removeNearestUnitAt`, `undoLastPlacement`, `persistPlayerLineup` |
| 兵種バー・詳細 | `renderUnitCards`, `selectPlaceable`, `updateUnitDetailOverlay` |
| アーケード | `loadArcadeStage`, `renderArcadeStageButtons`, `renderStageBriefing`, `renderEnemyChips` |
| サンドボックス | `loadPreset`, `PRESETS`（ファイル冒頭の定数） |
| TD モード | `enterTDMode`, `startTDRun`, `beginTDRun`, `handleTDBattleEnd`, `openTDChest`, `handleTDKey`（HUD 本体は `RealtimeTDHud.ts`） |
| TD オンライン対戦 | `enterTDVersusMode`（友人対戦→オンライン対戦の入口）, `tdVersus`（セッションとイベント）, `showTDVersusLobby`, `refreshTDVersusRooms`/`startTDVersusRoomPolling`（募集中の部屋の一覧）, `joinTDVersusRoom`, `startTDVersusRun`（`TDDuel` と `TDLockstep` を作る）, `startTDVersusWatch`（観戦）, `syncTDDuelChests`/`openNextTDDuelChest`（対戦の宝箱）, `handleTDVersusEnd`, `showTDVersusResult`, `disposeTDDuel`, `isTDVersusLive`（対戦中は `tick` で `tdLockstep.advance`） |
| チャレンジ | `enterChallengeMode`, `loadChallengeRound`, `handleChallengeBattleEnd`, `renderChallengePanel` |
| ローグライト | `enterRogueliteMode`, `startRogueRun`, `loadRogueRound`, `showRogueWarRoom`（作戦室）, `showRogueRewards`, `handleRogueBattleEnd`, `renderRoguePanel`, `showRogueModal` |
| 宝箱（共通） | `onRogueEnemyKilled`, `openDroppedChest`, `applyJackpotRewards`, `playJackpotRewardFx` |
| 友人対戦 | `showFriendChooser`（タイトルでローカル／オンラインを選ぶ）, ローカル対戦は `enterVersusMode`, `syncVersusUI`, `confirmVersusTurn` |
| 戦闘の開始/終了 | `startBattle`, `returnToPlacement`, `handleBattleEnd`, `startFinishSequence`, `renderBattleStats` |
| 毎フレーム | `tick`, `updateHUD`, `syncPhaseUI`, `updateRogueBattleHud` |

### RogueliteMode の中身（`src/game/RogueliteMode.ts`）

ファイル内の並び順（上から）:

1. 属性タグとシナジー: `TAG_INFO`, `UNIT_TAGS`, `countTags`, ゲート/パッシブレリックの数値定数
2. `class RogueliteRules`（戦闘中のルール: シナジー効果、連鎖爆発、雷連鎖、復活、`onDamage`）
3. ラン全体の定数 `ROGUE_*`（ラウンド数・ゴールド・枠・価格）と計算関数 `getRogue*` / `get*Price`
4. 敵編成: `generateRogueEnemyLineup`, `applyRogueEnemyLevels`, `getRogueEnemyPool`
5. スターター `ROGUE_STARTERS`、レリックの出現表 `ROGUE_RELIC_POOL`、レア度
6. `class RogueliteRun`（ラン状態: デッキ・購入・報酬・保存用 `toState/fromState`）
7. 報酬生成 `generateRewardOptions` / `applyReward`、セーブ `loadRogueRun` / `saveRogueRun`
8. レリック説明文 `relicDescription` / `gateEffectText`
9. `class RogueGateSequence`（開戦時のゲート通過演出）と `applyGateEnchant`
10. 自動配置 `generateRogueFormation`

### Unit の中身（`src/units/Unit.ts`）

| 領域 | 主なメソッド |
| --- | --- |
| 生成・毎ステップ | `constructor`, `update` |
| AI（標的選び・移動） | `think`, `findNearestEnemy`, `engageDistance`, `findNearestEnemyFacility`, 縄張りのある兵（第三勢力）の `thinkLeashed` |
| 攻撃 | `onWindupStart`, `updateAttack`, `onStrikeStart`（巨大）, `updateStrikeContinuous`, `shootArrow`, `throwBomb` |
| 兵種固有の技 | `updateSpecialMechanics`（巨大な分岐）, `updateGrabChain`/`tanimon*`（たにもん）, `fireMouthLaser`（はやと）, `updateYamamuronRage`/`fireVolcanoRock`（やまむろん）, `executeIaidoDash`, `triggerKawari`, `triggerDeoxysTeleport` |
| 体の制御 | `applyMuscles`, `computePose`（巨大）, `applyMountBinding` |
| ダメージ | `takeDamage`, `heal`, `absorbRangedDamage`, `die` |

### SceneView の中身（`src/render/SceneView.ts`）

| 領域 | 主なメソッド |
| --- | --- |
| シーン構築・テーマ | `setupLights`, `setupEnvironment`, `setStageTheme`, `setStageTerrain`, `drawGroundTexture` |
| 入力・カメラ | `setupInputListeners`, `screenToGround`, `updateCameraMovement`, `updateAutoCamera`, `playFinisherCamera`, `addCameraShake` |
| 配置ゴースト | `updatePlacementGhost`, `setVersusZones` |
| ユニット・施設の見た目 | `addUnitVisual`, `addFacilityVisual`, `syncFacilities` |
| エフェクト | `spawnCombatEffect`（**約 1400 行の巨大 switch**。効果の種類名で grep する）, `spawnHitEffect`, `updateFxAndDynamicVisuals`, `syncArrows` |
| HP バー・ハート | `updateHpBars`, `syncRogueHearts`, `renderRogueHearts` |
| 毎フレーム | `renderFrame` |

### VoxelModel の中身（`src/render/VoxelModel.ts`）

| 領域 | 主な関数 |
| --- | --- |
| 兵種モデル生成 | `buildHeadTemplate`（約 700 行）, `buildTorsoTemplate`（約 900 行）, `buildWeaponGeometry`, `buildOffhandGeometry`, `getUnitTemplateSet`。中は `type.id` ごとの分岐なので兵種 ID で grep する |
| 投射物 | `getProjectileGeometry` |
| `class VoxelCharacterVisual` | `sync`（毎フレーム）, 兵種別 `syncDragon` / `syncTank` / `syncRamiel` / `syncHayato` など, 部位破壊 `applyHitDamage` / `shatterPart` |
| 施設・ハート | `buildFacilityVoxelGrid`, `createFacilityMesh`, `buildHeartVoxelGrid` |

## やりたいこと → 見る場所

| やりたいこと | 見る場所 |
| --- | --- |
| 兵種を追加する | `UnitTypes.ts`（`UnitTypeId` と `UNIT_TYPES`）→ 見た目 `VoxelModel.ts`（`buildHeadTemplate` / `buildTorsoTemplate`）→ アイコン `UnitIcons.ts` `getUnitIconSvg` → ローグライトのタグ `RogueliteMode.ts` `UNIT_TAGS`（型で必須）→ 特殊技なら `Unit.ts` `updateSpecialMechanics` |
| 兵種の数値調整 | `UnitTypes.ts` の該当エントリ |
| 攻撃・エフェクトを足す | `CombatSystem.ts`（`CombatEffectEvent` 型）→ 描画 `SceneView.ts` `spawnCombatEffect` → 音 `SoundManager.ts` `playEffect` → 画面の揺れ `fx/FxCues.ts` `FX_EFFECT_CUES` |
| 演出（揺れ・ヒットストップ・告知）の調整 | `fx/FxCues.ts` の `FX_CUES` と `FX_*` 定数 |
| 施設・レリック・ゲート | `FacilityTypes.ts`（定義と数値）→ `Facility.ts`（挙動）→ ローグライトでの説明 `RogueliteMode.ts` `relicDescription` / `gateEffectText` |
| アーケード面の追加・修正 | `ArcadeStages.ts` `ARCADE_STAGES` |
| ローグライトの経済・難易度 | `RogueliteMode.ts` の `ROGUE_*` 定数と `getRogue*` 関数 |
| ローグライトの画面 | `GameApp.ts` の `showRogue*` / `renderRogue*` ＋ `style.css` 後半 |
| TD モードの数値 | `RealtimeTDMode.ts` 冒頭の `TD_*` 定数 |
| TD モードの画面 | `RealtimeTDHud.ts` ＋ `td.css` |
| TD オンライン対戦 | 対面の戦場と同期 `TDDuel.ts`、第三勢力 `TDWildCamps.ts`、陣営ごとのラン `RealtimeTDMode.ts`（`TD_DUEL_*`）、乱数 `SimRandom.ts`、進行 `TDVersusSession.ts`、通信 `src/net/`、サーバー `server/`、画面 `ui/TDVersusUi.ts`、仕様 `REALTIME_TD_SPEC.md` §16 |
| 宝箱・リール報酬 | `RogueJackpot.ts`（中身）、`JackpotRoulette.ts`（進行）、`render/Jackpot*`（3D） |
| 地形生成 | `field/FieldGenerator.ts`、戦闘中の地形の挙動は `field/FieldRuntime.ts` |
| 物理の挙動 | `physics/PhysicsWorld.ts`、体の動きは `Unit.ts` `applyMuscles` |
| UI の絵・アイコンを足す | `ui/VoxelIcons.ts` の `SPRITES` に行を足す → `vx('名前')`。見た目は `icons.html` で確認。色・枠・影は `theme.css` のトークン |
| 毎フレーム書き換える HUD の文字 | `fx/ui/dom.ts` の `setHtml`（中身が変わったときだけ innerHTML を書き換える） |

## 仕様書（ルート直下の .md）

最新の決定は各仕様書の末尾の「決定事項」「実装メモ」節にあることが多い。必要なものだけ読む。

| ファイル | 内容・状態 |
| --- | --- |
| `REALTIME_TD_SPEC.md` | TD モード（実装済み・調整中。§12 が優先、§16 がオンライン対戦） |
| `FX_SPEC.md` | 演出・手触り強化の共通基盤（`src/fx/`）と TD 対戦への適用（F1〜F4 実装済み。F5 他モードは別途） |
| `ROGUELITE_V3_SPEC.md` | ローグライト現行版（デッキ＋ゴールド強化。実装済み） |
| `ROGUELITE_DIFFICULTY_SPEC.md` | 難易度階層・エンドレス |
| `RELIC_UPDATE_SPEC.md` | レリック変更 5 件 |
| `ROGUELITE_UI_RENEWAL_SPEC.md` | ローグライト UI 刷新 |
| `FIELD_PROCGEN_SPEC.md` | フィールド手続き生成（実装済み） |
| `ROGUELITE_V2_NOTES.md` / `ROGUELITE_REWORK_SPEC.md` / `ROGUELITE_REVIEW_1110.md` | 旧版の経緯（通常は読まなくてよい） |
| `チャレンジモード仕様.MD` | チャレンジモードのドラフト |
| `README.md` | プレイヤー向けの遊び方（機能を変えたら更新する） |
