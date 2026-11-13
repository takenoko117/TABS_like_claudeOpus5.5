import { CameraFx } from './CameraFx';
import {
  FX_COMBO_MAX_SEMITONES,
  FX_COMBO_SEMITONE,
  FX_COMBO_WINDOW,
  FX_CUES,
  FX_FLASH_MAX_PER_SECOND,
  FX_LEVEL_SCALE,
  type FxCue,
  type FxCueId,
  type FxFlashKind,
  type FxLevel,
  type FxTier,
} from './FxCues';
import { TimeFx } from './TimeFx';

/** 演出を実際に動かす差し込み口（Three.js・DOM・WebAudio の側が実装する） */
export interface FxSinks {
  /** 画面全体のフラッシュ（strength 0〜1） */
  flash?: (kind: FxFlashKind, strength: number) => void;
  /** 被弾したユニットの白フラッシュ */
  unitFlash?: (unitId: number, strength: number) => void;
  /** 効果音（pitch は再生速度の倍率） */
  sound?: (name: string, tier: FxTier, pitch: number) => void;
}

export interface FxEmitOptions {
  tier: FxTier;
  /** 衝撃の向き（水平。カメラを押す向き） */
  dir?: { x: number; z: number };
  /** 被弾したユニット（unitFlash 用） */
  unitId?: number;
  /** 音程の倍率（連続撃破など） */
  pitch?: number;
}

/** 1 回の emit で実際に動かした値（テスト用） */
export interface FxApplied {
  shake: number;
  kick: number;
  zoomPunch: number;
  hitStop: number;
  slow: number;
  flash: FxFlashKind | null;
  unitFlash: number;
  sound: string | null;
}

export interface FxComboState {
  count: number;
  /** 音程の倍率 */
  pitch: number;
}

/**
 * 演出の指揮役（FX_SPEC.md §4.1）。ゲーム側は `emit(cue, { tier })` で「何が・どのくらい」起きたかだけを伝える。
 * 揺れ（CameraFx）と時間（TimeFx）はここが持ち、フラッシュ・ユニットの光・音は差し込み口へ回す。
 * Three.js・DOM に依存しないので、強さの計算・重なり・クールダウンを vitest で検証できる。
 */
export class FxDirector {
  readonly camera = new CameraFx();
  readonly time = new TimeFx();
  sinks: FxSinks = {};
  /** 演出の強さの設定 */
  private levelValue: FxLevel = 'full';
  /** 画面の揺れだけを切る設定 */
  private shakeOn = true;
  /** 一時的に最小にする（観戦の追いつき中・タイトルのデモ中）。音も鳴らさない */
  suppressed = false;
  /** 戦場ごと止めてよいか（1 人用モードのみ。対戦・観戦は false） */
  allowBattleStop = false;
  private clock = 0;
  private readonly lastCue = new Map<FxCueId, number>();
  private readonly flashTimes: number[] = [];
  private comboCount = 0;
  private comboTimer = 0;

  constructor(level: FxLevel = 'full', shake = true) {
    this.setLevel(level, shake);
  }

  get level(): FxLevel {
    return this.levelValue;
  }

  setLevel(level: FxLevel, shake = this.shakeOn): void {
    this.levelValue = level;
    this.shakeOn = shake;
    this.camera.shakeScale = shake ? 1 : 0;
  }

  /** 今効いている強さ（一時的に最小にしているときは minimal） */
  private get effectiveLevel(): FxLevel {
    return this.suppressed ? 'minimal' : this.levelValue;
  }

  /** 演出を起こす。クールダウン中なら null */
  emit(id: FxCueId, opts: FxEmitOptions): FxApplied | null {
    const cue = FX_CUES[id];
    if (cue.cooldown) {
      const last = this.lastCue.get(id);
      if (last !== undefined && this.clock - last < cue.cooldown) return null;
      this.lastCue.set(id, this.clock);
    }
    const applied = this.resolve(cue, opts.tier);
    if (applied.shake > 0) this.camera.addTrauma(applied.shake);
    if (applied.kick > 0 && opts.dir) this.camera.kick(opts.dir.x, opts.dir.z, applied.kick);
    if (applied.zoomPunch > 0) this.camera.zoomPunch(applied.zoomPunch);
    if (applied.hitStop > 0) this.time.hitStop(applied.hitStop);
    if (applied.slow > 0) this.time.slow(applied.slow, cue.slowScale ?? 0.5);
    if (applied.flash) {
      if (this.tryFlash()) this.sinks.flash?.(applied.flash, 0.4 + opts.tier * 0.2);
      else applied.flash = null;
    }
    if (applied.unitFlash > 0 && opts.unitId !== undefined) this.sinks.unitFlash?.(opts.unitId, applied.unitFlash);
    if (applied.sound && !this.suppressed) this.sinks.sound?.(applied.sound, opts.tier, opts.pitch ?? 1);
    else applied.sound = null;
    return applied;
  }

  /** 表を通さずに揺れだけを足す（従来の addCameraShake の互換用）。強さの設定は効く */
  addShake(trauma: number): void {
    if (!this.shakeOn) return;
    this.camera.addTrauma(trauma * Math.sqrt(FX_LEVEL_SCALE[this.effectiveLevel].shake));
  }

  /** 表と強さの設定から、各チャンネルの値を決める（副作用なし） */
  resolve(cue: FxCue, tier: FxTier): FxApplied {
    const s = FX_LEVEL_SCALE[this.effectiveLevel];
    let flash = cue.flash?.[tier] ?? null;
    if (s.flash === 'none') flash = null;
    else if (s.flash === 'edge' && flash !== 'red-edge') flash = null;
    return {
      // 揺れ幅は trauma² なので、揺れ幅を s.shake 倍にするにはトラウマを平方根倍にする
      shake: (cue.shake?.[tier] ?? 0) * Math.sqrt(s.shake) * (this.shakeOn ? 1 : 0),
      kick: (cue.kick?.[tier] ?? 0) * s.kick * (this.shakeOn ? 1 : 0),
      zoomPunch: (cue.zoomPunch?.[tier] ?? 0) * s.zoomPunch,
      hitStop: (cue.hitStop?.[tier] ?? 0) * s.hitStop,
      slow: (cue.slow?.[tier] ?? 0) * s.slow,
      flash,
      unitFlash: (cue.unitFlash?.[tier] ?? 0) * s.unitFlash,
      sound: cue.sound ?? null,
    };
  }

  /** フラッシュは 1 秒に FX_FLASH_MAX_PER_SECOND 回まで */
  private tryFlash(): boolean {
    while (this.flashTimes.length > 0 && this.clock - this.flashTimes[0] >= 1) this.flashTimes.shift();
    if (this.flashTimes.length >= FX_FLASH_MAX_PER_SECOND) return false;
    this.flashTimes.push(this.clock);
    return true;
  }

  /** 撃破を数える（短い時間に続けて倒すほど数が増え、音程が上がる） */
  registerKill(): FxComboState {
    this.comboCount = this.comboTimer > 0 ? this.comboCount + 1 : 1;
    this.comboTimer = FX_COMBO_WINDOW;
    return this.combo;
  }

  get combo(): FxComboState {
    const semis = Math.min(FX_COMBO_MAX_SEMITONES, Math.max(0, this.comboCount - 1) * FX_COMBO_SEMITONE);
    return { count: this.comboTimer > 0 ? this.comboCount : 0, pitch: Math.pow(2, semis / 12) };
  }

  /** 毎フレーム（実時間）。カメラのばねと時間の演出を進める */
  update(realDt: number): void {
    if (realDt <= 0) return;
    this.clock += realDt;
    this.time.update(realDt);
    this.camera.update(realDt);
    if (this.comboTimer > 0) {
      this.comboTimer = Math.max(0, this.comboTimer - realDt);
      if (this.comboTimer === 0) this.comboCount = 0;
    }
  }

  /** 戦場に渡す時間の倍率（対戦・観戦では必ず 1） */
  battleScale(): number {
    return this.time.battleScale(this.allowBattleStop);
  }

  /** 戦闘の切り替えで演出を止める */
  reset(): void {
    this.camera.reset();
    this.time.reset();
    this.lastCue.clear();
    this.flashTimes.length = 0;
    this.comboCount = 0;
    this.comboTimer = 0;
  }
}
