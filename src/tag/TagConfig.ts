/**
 * 鬼ごっこモード（かぶくん vs ハヤト）の数値。
 * シミュレーション（TagSim）・町の生成（GifuTown）・描画・画面のすべてがここを読む。数値の調整はここで行う。
 * 1 ブロック = 1 m。
 */

// ---- 町（岐阜の町・お昼） ----
/** 町の横幅（x = 東） */
export const TAG_SIZE_X = 176;
/** 町の奥行き（z = 南。z = 0 が北の長良川側） */
export const TAG_SIZE_Z = 192;
/** 町の高さ */
export const TAG_SIZE_Y = 56;
/** 地面の高さ（この y に立つ。y < TAG_GROUND が土台） */
export const TAG_GROUND = 6;

// ---- プレイヤー（かぶくん） ----
/** 体の半幅（当たり判定の箱） */
export const TAG_PLAYER_HALF = 0.42;
/** 体の高さ */
export const TAG_PLAYER_HEIGHT = 1.3;
/** 歩く速さ（m/s） */
export const TAG_WALK_SPEED = 5.2;
/** ダッシュの速さ（m/s） */
export const TAG_SPRINT_SPEED = 8.4;
/** ダッシュできる長さ（秒）。使い切ると息が戻るまで走れない */
export const TAG_STAMINA_MAX = 3.5;
/** 息の戻る速さ（1 秒あたり） */
export const TAG_STAMINA_REGEN = 0.8;
/** 息を使い切ったあと、走れるようになる残量 */
export const TAG_STAMINA_RECOVER = 1.2;
/** ジャンプの初速 */
export const TAG_JUMP_SPEED = 7.2;
/** 重力 */
export const TAG_GRAVITY = 22;
/** 何回レーザーに当たるとアウトか */
export const TAG_MAX_HP = 3;
/** 当たったあと、次に当たらない時間（秒） */
export const TAG_INVULN_TIME = 2;
/** 当たったときに飛ばされる速さ */
export const TAG_KNOCKBACK = 7;

// ---- 鬼（ハヤト） ----
/** 始まったときのハヤトの数 */
export const TAG_HAYATO_START = 1;
/** この秒数ごとにハヤトが 1 人増える */
export const TAG_HAYATO_SPAWN_INTERVAL = 20;
/** ハヤトの最大数 */
export const TAG_HAYATO_MAX = 16;
/** 増えるハヤトは、生きているプレイヤー全員からこの距離以上離れた所に出る */
export const TAG_HAYATO_SPAWN_MIN_DIST = 40;
/** うろつく速さ（m/s） */
export const TAG_HAYATO_WANDER_SPEED = 3.4;
/** 追いかける速さ（m/s） */
export const TAG_HAYATO_CHASE_SPEED = 5.4;
/** 時間がたつほど速くなる（1 分あたりの倍率の上がり幅。上限 TAG_HAYATO_SPEEDUP_MAX） */
export const TAG_HAYATO_SPEEDUP_PER_MIN = 0.06;
export const TAG_HAYATO_SPEEDUP_MAX = 1.4;
/** 地面から浮く高さ（顔の中心） */
export const TAG_HAYATO_HOVER = 2.4;
/** 浮いて越えられる高さの上限（地面から） */
export const TAG_HAYATO_MAX_RISE = 9;
/** 顔の大きさ（高さ m） */
export const TAG_HAYATO_SIZE = 1.7;
/** 当たり判定の半径（壁との） */
export const TAG_HAYATO_RADIUS = 0.75;
/** 見える距離 */
export const TAG_SIGHT_RANGE = 32;
/** 見える角度（前方からの cos。0.3 ≒ 左右 72°） */
export const TAG_SIGHT_COS = 0.3;
/** この距離より近いと、後ろにいても気づく */
export const TAG_SENSE_RANGE = 5;
/** 見失ってから最後に見た場所を探す時間（秒） */
export const TAG_SEARCH_TIME = 6;
/** 追いかけるとき、プレイヤーとこの距離を保とうとする */
export const TAG_CHASE_KEEP = 9;

// ---- レーザー ----
/** 見つけてから撃つまでのため（秒）。この間、口が開いて照準の線が見える */
export const TAG_LASER_CHARGE = 0.85;
/** 撃ったあと次のためを始めるまで（秒） */
export const TAG_LASER_COOLDOWN = 1.9;
/** 弾の速さ（m/s） */
export const TAG_LASER_SPEED = 36;
/** 弾が届く距離 */
export const TAG_LASER_RANGE = 48;
/** 弾の当たり判定の半径 */
export const TAG_LASER_RADIUS = 0.35;
/** 撃つとき、相手の動きをどれだけ先読みするか（0 = しない, 1 = 完全に） */
export const TAG_LASER_LEAD = 0.45;

// ---- オンライン ----
/** 自分の位置を送る間隔（秒） */
export const TAG_POS_INTERVAL = 1 / 15;
/** ホストが鬼の様子を送る間隔（秒） */
export const TAG_SNAP_INTERVAL = 1 / 10;

/** プレイヤーごとの目印の色（席の番号順） */
export const TAG_PLAYER_COLORS: readonly number[] = [0x3fa7ff, 0xff5a4e, 0xffd23f, 0x5ad46a, 0xc77dff, 0xff9a3c];

/** ソロのベスト記録を保存するキー */
export const TAG_BEST_KEY = 'exblocks-tag-best';
