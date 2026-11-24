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
export const TAG_PLAYER_HALF = 0.5;
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
/** 当たったときに横へふっとぶ速さ（開けた所なら 50 m ほど飛ぶ。敵から一気に離れられる） */
export const TAG_KNOCKBACK = 19;
/** 当たったときに上へふっとぶ速さ */
export const TAG_KNOCKBACK_UP = 13;
/** ふっとんでいる間の重力の倍率（ふわっと長く飛ぶ） */
export const TAG_FLING_GRAVITY = 0.6;
/** ふっとんでいる間の空気抵抗（1 秒あたりに横の速さが減る割合） */
export const TAG_FLING_DRAG = 0.12;
/** ふっとんで壁・天井・町の端に当たったときに跳ね返る割合 */
export const TAG_FLING_BOUNCE = 0.6;
/** ふっとんで着地したときに弾む割合（この速さより速く落ちたときだけ弾む） */
export const TAG_FLING_LAND_BOUNCE = 0.5;
export const TAG_FLING_BOUNCE_MIN = 3;
/** 着地で弾むとき、横の速さを残す割合 */
export const TAG_FLING_LAND_KEEP = 0.85;
/** 地面を転がるときの摩擦（1 秒あたりに減る速さ m/s） */
export const TAG_FLING_FRICTION = 12;
/** ふっとびが終わる横の速さ（これより遅くなって着地していれば操作が戻る） */
export const TAG_FLING_END_SPEED = 2.5;
/** ふっとびの最長時間（秒） */
export const TAG_FLING_MAX = 5;

// ---- 鬼（ハヤト） ----
/** 始まったときのハヤトの数 */
export const TAG_HAYATO_START = 4;
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

// ---- 青鬼ハヤト（でかくて青い。ダッシュと同じ速さでどこまでも追う。触れられたら食べられてアウト） ----
/** 最初の青鬼が出る時刻（秒） */
export const TAG_BLUE_FIRST = 60;
/** そのあと、この秒数ごとに増える */
export const TAG_BLUE_INTERVAL = 90;
/** 青鬼の最大数 */
export const TAG_BLUE_MAX = 2;
/** 顔の大きさ（高さ m）。ふつうのハヤトの 2 倍 */
export const TAG_BLUE_SIZE = 3.4;
/** 壁との当たり判定の半径。幅 2.6 m なので、幅 2 ブロックの路地には入れない */
export const TAG_BLUE_RADIUS = 1.3;
/** 地面から浮く高さ（顔の下の端） */
export const TAG_BLUE_HOVER = 0.15;
/** 段差を乗り越えられる高さ（ふつうのハヤトのように建物は越えない） */
export const TAG_BLUE_MAX_RISE = 1.6;
/** 追う速さ。プレイヤーのダッシュと同じ（息が切れたら追いつかれる） */
export const TAG_BLUE_SPEED = TAG_SPRINT_SPEED;
/** うろつく速さ */
export const TAG_BLUE_WANDER_SPEED = 3;
/** 見つける距離（見つけたら見えなくなっても居場所を知って追い続ける） */
export const TAG_BLUE_SIGHT_RANGE = 36;
/** 触れたら食べられる距離の余裕（体の半径の和に足す） */
export const TAG_BLUE_TOUCH = 0.2;
/** 食べている時間（秒）。この間は止まる */
export const TAG_BLUE_EAT_TIME = 2.4;
/** 狙いを近くのほかの人に移す差（いまの相手よりこれだけ近い人がいたら移る） */
export const TAG_BLUE_SWITCH = 4;
/** 相手に近づけないまま（路地の奥など）この秒数がたつと、あきらめる */
export const TAG_BLUE_GIVEUP = 5;
/** あきらめた相手を、また狙うまでの時間（秒） */
export const TAG_BLUE_IGNORE = 12;
/** 壁につかえたとき、横へ回り込む時間（秒） */
export const TAG_BLUE_DETOUR = 1.4;

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

// ---- お邪魔の道具（パンチ・ロケット） ----
/** パンチが届く距離（横方向） */
export const TAG_PUNCH_RANGE = 2.2;
/** パンチの高さの許容差 */
export const TAG_PUNCH_HEIGHT = 1.6;
/** パンチを打ったあと、次に打てるまで（秒） */
export const TAG_PUNCH_COOLDOWN = 2.5;
/** パンチで相手が動けなくなる時間（秒） */
export const TAG_PUNCH_STUN = 3;
/** パンチで相手がふっとぶ速さ（レーザーに当たったときと同じく 50 m ほど飛ぶ） */
export const TAG_PUNCH_KNOCK = TAG_KNOCKBACK;
/** パンチで相手が上へふっとぶ速さ */
export const TAG_PUNCH_KNOCK_UP = TAG_KNOCKBACK_UP;
/** 町に落ちているロケットの数 */
export const TAG_ROCKET_PICKUPS = 14;
/** 拾われたロケットが同じ場所にまた出るまで（秒） */
export const TAG_ROCKET_RESPAWN = 25;
/** ロケットを持てる最大の数 */
export const TAG_ROCKET_MAX = 3;
/** 拾える距離 */
export const TAG_ROCKET_PICK_RADIUS = 1.4;
/** ロケットの速さ（m/s） */
export const TAG_ROCKET_SPEED = 30;
/** ロケットが飛ぶ距離 */
export const TAG_ROCKET_RANGE = 70;
/** 撃ったあと次を撃てるまで（秒） */
export const TAG_ROCKET_COOLDOWN = 0.7;
/** ロケットが直接当たる半径（人・ハヤト） */
export const TAG_ROCKET_HIT_RADIUS = 0.9;
/** 爆発で地形を壊す半径（ブロック） */
export const TAG_ROCKET_BLAST = 2.8;
/** 爆発で人やハヤトをひるませる半径 */
export const TAG_ROCKET_STUN_RADIUS = 4;
/** 爆風でプレイヤーが動けなくなる時間（秒） */
export const TAG_ROCKET_STUN = 1.5;
/** 爆風でハヤトが止まる時間（秒） */
export const TAG_ROCKET_HAYATO_STUN = 2.5;
/** 爆風で飛ばされる速さ */
export const TAG_ROCKET_KNOCK = 9;
