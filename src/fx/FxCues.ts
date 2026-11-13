/**
 * 演出の表（レシピ）。ゲーム側は「何が・どのくらい強く起きたか（tier）」だけを FxDirector に伝え、
 * 揺れ・ヒットストップ・フラッシュ・音などをどれだけ動かすかはこの表で決める（FX_SPEC.md §4.1）。
 * Three.js にも DOM にも依存しない。数値の調整はこのファイルだけで済むようにする。
 */

/** 強さの段階。0: ささやか / 1: はっきり / 2: 見せ場 / 3: 最大 */
export type FxTier = 0 | 1 | 2 | 3;

/** 画面全体のフラッシュの種類 */
export type FxFlashKind = 'white' | 'red-edge' | 'gold';

/** tier ごとの値（index = tier） */
export type TierValues<T> = readonly [T, T, T, T];

export interface FxCue {
  /** 揺れの元になるトラウマ量（足し算で溜まる。0〜1） */
  shake?: TierValues<number>;
  /** 衝撃の向きにカメラを押す強さ（ワールド単位） */
  kick?: TierValues<number>;
  /** FOV を一瞬狭める割合（0.05 = 5%） */
  zoomPunch?: TierValues<number>;
  /** ヒットストップの秒数（描画のみ。1 人用モードでは戦場ごと止めてよい） */
  hitStop?: TierValues<number>;
  /** スローの秒数と速度倍率（1 人用は戦場ごと、対戦は演出の時間のみ） */
  slow?: TierValues<number>;
  slowScale?: number;
  /** 画面全体のフラッシュ（null は出さない） */
  flash?: TierValues<FxFlashKind | null>;
  /** 被弾したユニット自身の白フラッシュの強さ（0〜1。描画のみ） */
  unitFlash?: TierValues<number>;
  /** 効果音の名前（SoundManager.playFxCue） */
  sound?: string;
  /** 同じ演出の最短間隔（秒）。連続しても間隔を守る */
  cooldown?: number;
}

/** 演出の種類 */
export type FxCueId =
  | 'unit_hit'
  | 'heavy_hit'
  | 'explosion'
  | 'castle_hit'
  | 'castle_strike'
  | 'castle_stage2'
  | 'terrain_shift'
  | 'deploy'
  | 'kill'
  | 'boss_spawn'
  | 'boss_down'
  | 'reward'
  | 'countdown'
  | 'finish';

/**
 * 演出の表。小ヒットはユニットのフラッシュだけ（揺れなし）で処理し、重い一撃から揺れが乗る（決定事項 R1）。
 */
export const FX_CUES: Readonly<Record<FxCueId, FxCue>> = {
  // 通常の被弾: ユニットが白く光るだけ。数百体が殴り合っても画面は揺らさない
  unit_hit: {
    unitFlash: [0.55, 0.75, 0.9, 1],
  },
  // 重い一撃（巨人・象・ドラゴン・大ダメージ）
  heavy_hit: {
    unitFlash: [0.8, 1, 1, 1],
    shake: [0.2, 0.35, 0.45, 0.6],
    kick: [0, 0.08, 0.16, 0.24],
    hitStop: [0, 0.03, 0.05, 0.08],
    cooldown: 0.1,
  },
  // 爆発・大技
  explosion: {
    shake: [0.45, 0.55, 0.67, 0.85],
    kick: [0.06, 0.12, 0.2, 0.3],
    zoomPunch: [0, 0, 0.04, 0.07],
    hitStop: [0, 0, 0.05, 0.09],
    flash: [null, null, null, 'white'],
    cooldown: 0.05,
  },
  // 城が攻撃を受けた
  castle_hit: {
    shake: [0.15, 0.3, 0.45, 0.6],
    kick: [0, 0.06, 0.14, 0.22],
    hitStop: [0, 0, 0.05, 0.09],
    flash: [null, 'red-edge', 'red-edge', 'red-edge'],
    sound: 'castle_hit',
    cooldown: 0.12,
  },
  // 相手の城を攻撃した（観戦では両方の城）。赤い縁は出さない
  castle_strike: {
    shake: [0.1, 0.2, 0.35, 0.5],
    hitStop: [0, 0, 0.05, 0.08],
    cooldown: 0.15,
  },
  // 地形変化の瞬間（地面が波打つ）
  terrain_shift: {
    shake: [0.35, 0.45, 0.55, 0.65],
    sound: 'rumble',
    cooldown: 1,
  },
  // 城の第二段階への移行（見せ場）
  castle_stage2: {
    shake: [0.55, 0.65, 0.75, 0.85],
    zoomPunch: [0.04, 0.05, 0.06, 0.08],
    hitStop: [0.06, 0.08, 0.1, 0.12],
    slow: [0.6, 0.8, 1.0, 1.2],
    slowScale: 0.45,
    flash: ['white', 'white', 'white', 'white'],
    sound: 'stage2',
    cooldown: 1,
  },
  // 出撃
  deploy: {
    shake: [0.1, 0.18, 0.25, 0.3],
    cooldown: 0.05,
  },
  // 撃破
  kill: {
    unitFlash: [1, 1, 1, 1],
    shake: [0, 0.15, 0.3, 0.45],
    hitStop: [0, 0, 0.04, 0.07],
  },
  // ボス・ヌシの出現
  boss_spawn: {
    shake: [0.45, 0.6, 0.75, 0.9],
    zoomPunch: [0, 0.03, 0.05, 0.07],
    sound: 'rumble',
    cooldown: 1,
  },
  // ボス・ヌシの撃破
  boss_down: {
    shake: [0.45, 0.55, 0.7, 0.85],
    zoomPunch: [0, 0.03, 0.05, 0.07],
    hitStop: [0.04, 0.06, 0.09, 0.12],
    slow: [0, 0, 0.7, 1],
    slowScale: 0.5,
    flash: [null, 'gold', 'gold', 'gold'],
    cooldown: 0.5,
  },
  // 報酬の獲得
  reward: {
    flash: [null, null, 'gold', 'gold'],
    cooldown: 0.3,
  },
  // 残り時間のカウントダウン
  countdown: {
    shake: [0, 0.15, 0.25, 0.35],
    sound: 'countdown',
    cooldown: 0.3,
  },
  // 決着
  finish: {
    shake: [0.6, 0.7, 0.8, 0.95],
    zoomPunch: [0.04, 0.05, 0.07, 0.09],
    hitStop: [0.06, 0.08, 0.1, 0.14],
    flash: ['white', 'white', 'white', 'white'],
    cooldown: 1,
  },
};

/**
 * 戦闘エフェクトの種類 → 演出（従来の SHAKE_BY_EFFECT を tier で整理したもの）。
 * 載っていないエフェクトは揺らさない
 */
export const FX_EFFECT_CUES: Readonly<Record<string, { cue: FxCueId; tier: FxTier }>> = {
  bomb_explosion: { cue: 'explosion', tier: 0 },
  rocket_explosion: { cue: 'explosion', tier: 1 },
  gravity_blast: { cue: 'explosion', tier: 1 },
  facility_destroy: { cue: 'explosion', tier: 1 },
  satellite_beam: { cue: 'explosion', tier: 1 },
  ramiel_beam: { cue: 'explosion', tier: 1 },
  tank_explosion: { cue: 'explosion', tier: 2 },
  eruption_explosion: { cue: 'explosion', tier: 2 },
  robot_punch_impact: { cue: 'explosion', tier: 2 },
  sachiel_cross: { cue: 'explosion', tier: 2 },
  sahaquiel_bomb: { cue: 'explosion', tier: 2 },
  yamamuron_quake: { cue: 'explosion', tier: 3 },
  yamamuron_awaken: { cue: 'explosion', tier: 3 },
  stage_meteor_impact: { cue: 'explosion', tier: 3 },
};

/** 重い一撃とみなすダメージ（これ未満の被弾はユニットのフラッシュだけ） */
export const FX_HEAVY_HIT_DAMAGE = 45;
/** 重い一撃の tier を決めるダメージの段階（以上で tier 1, 2, 3） */
export const FX_HEAVY_HIT_TIERS: readonly [number, number, number] = [70, 120, 200];

/** 演出の強さの設定 */
export type FxLevel = 'full' | 'reduced' | 'minimal';

export interface FxLevelScale {
  shake: number;
  kick: number;
  zoomPunch: number;
  hitStop: number;
  slow: number;
  /** フラッシュ: all = すべて / edge = 縁だけ（white・gold は出さない） / none */
  flash: 'all' | 'edge' | 'none';
  unitFlash: number;
}

/** 演出の強さごとの倍率（控えめ: 揺れ 50%・ズームパンチなし・フラッシュは縁だけ／最小: 情報だけ残す） */
export const FX_LEVEL_SCALE: Readonly<Record<FxLevel, FxLevelScale>> = {
  full: { shake: 1, kick: 1, zoomPunch: 1, hitStop: 1, slow: 1, flash: 'all', unitFlash: 1 },
  reduced: { shake: 0.5, kick: 0.5, zoomPunch: 0, hitStop: 0.6, slow: 1, flash: 'edge', unitFlash: 0.7 },
  minimal: { shake: 0, kick: 0, zoomPunch: 0, hitStop: 0, slow: 0, flash: 'none', unitFlash: 0.4 },
};

/** フラッシュは 1 秒に 3 回まで（光過敏への配慮） */
export const FX_FLASH_MAX_PER_SECOND = 3;
/** トラウマの上限と、1 秒あたりの減り方 */
export const FX_TRAUMA_MAX = 1;
export const FX_TRAUMA_DECAY = 2;
/** 揺れ幅の最大（trauma = 1 のとき。ワールド単位）とロールの最大（ラジアン） */
export const FX_SHAKE_MAX_OFFSET = 0.6;
export const FX_SHAKE_MAX_ROLL = 0.035;
/** 揺れのノイズの速さ（1 秒あたりの周期数） */
export const FX_SHAKE_FREQUENCY = 18;
/** 方向キックとズームパンチのばね（固有角振動数と減衰比） */
export const FX_SPRING_OMEGA = 34;
export const FX_SPRING_DAMPING = 0.55;
/** ヒットストップの上限（秒）。重なっても長くなりすぎないようにする */
export const FX_HITSTOP_MAX = 0.14;
/** ヒットストップが明けてから次を受け付けるまでの秒数（止まりっぱなしにしない） */
export const FX_HITSTOP_MIN_GAP = 0.3;
/** 撃破の連鎖（コンボ）が途切れるまでの秒数と、音程の上がり方（1 撃破ごとの半音数・上限） */
export const FX_COMBO_WINDOW = 1.6;
export const FX_COMBO_SEMITONE = 1;
export const FX_COMBO_MAX_SEMITONES = 12;
/** コンボ表示を出し始める撃破数 */
export const FX_COMBO_SHOW_FROM = 3;
/** 告知の表示時間（tier ごと、秒）。軽い告知は短く順番に流す */
export const FX_BANNER_DURATION: TierValues<number> = [1.1, 1.6, 2.2, 2.8];
/** 同じ告知をまとめる時間（秒） */
export const FX_BANNER_MERGE_WINDOW = 1.5;
/** 待たせておける告知の数 */
export const FX_BANNER_QUEUE_MAX = 4;
/** 粒子数の倍率（自動画質の段階 0/1/2 ごと） */
export const FX_PARTICLE_SCALE_BY_QUALITY: readonly [number, number, number] = [0.4, 0.7, 1];
