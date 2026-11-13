import type { FxLevel } from '../fx/FxCues';

/** 描画品質。auto は実測フレームレートを見て自動で下げる */
export type QualitySetting = 'auto' | 'high' | 'low';

export interface GameSettings {
  /** BGM の音量（0〜1） */
  musicVolume: number;
  /** 効果音の音量（0〜1） */
  sfxVolume: number;
  quality: QualitySetting;
  /** 傷ついたユニットの頭上に HP バーを出すか */
  showHpBars: boolean;
  /** 演出の強さ（フル／控えめ／最小） */
  fxLevel: FxLevel;
  /** 画面の揺れ（演出の強さとは別に、揺れだけ切れる） */
  cameraShake: boolean;
}

export const DEFAULT_SETTINGS: Readonly<GameSettings> = {
  musicVolume: 0.5,
  sfxVolume: 0.55,
  quality: 'auto',
  showHpBars: true,
  fxLevel: 'full',
  cameraShake: true,
};

const STORAGE_KEY = 'tabs_voxel_settings_v1';

function clampVolume(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

/** 保存文字列を検証して設定に戻す。不正な項目は既定値にする。
 * reducedMotion: OS の「視差効果を減らす」が有効なら、演出の強さの初期値を「最小」にする */
export function parseSettings(raw: string | null, reducedMotion = false): GameSettings {
  let parsed: Partial<Record<keyof GameSettings, unknown>> = {};
  try {
    const value = JSON.parse(raw ?? '{}') as unknown;
    if (typeof value === 'object' && value !== null) parsed = value;
  } catch {
    // 壊れたデータは既定値で上書きする
  }
  return {
    musicVolume: clampVolume(parsed.musicVolume, DEFAULT_SETTINGS.musicVolume),
    sfxVolume: clampVolume(parsed.sfxVolume, DEFAULT_SETTINGS.sfxVolume),
    quality:
      parsed.quality === 'high' || parsed.quality === 'low' || parsed.quality === 'auto'
        ? parsed.quality
        : DEFAULT_SETTINGS.quality,
    showHpBars: typeof parsed.showHpBars === 'boolean' ? parsed.showHpBars : DEFAULT_SETTINGS.showHpBars,
    fxLevel:
      parsed.fxLevel === 'full' || parsed.fxLevel === 'reduced' || parsed.fxLevel === 'minimal'
        ? parsed.fxLevel
        : reducedMotion
          ? 'minimal'
          : DEFAULT_SETTINGS.fxLevel,
    cameraShake: typeof parsed.cameraShake === 'boolean' ? parsed.cameraShake : DEFAULT_SETTINGS.cameraShake,
  };
}

export function loadSettings(): GameSettings {
  try {
    return parseSettings(window.localStorage.getItem(STORAGE_KEY), reducedMotion());
  } catch {
    return { ...DEFAULT_SETTINGS, fxLevel: reducedMotion() ? 'minimal' : DEFAULT_SETTINGS.fxLevel };
  }
}

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
}

export function saveSettings(settings: GameSettings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // 保存できない環境では今回のプレイ中だけ有効にする
  }
}

/** 記録を消すときの対象キーの接頭辞（設定は残す） */
export const PROGRESS_STORAGE_PREFIX = 'tabs_voxel_';
export const SETTINGS_STORAGE_KEY = STORAGE_KEY;

/** 実測フレームレートから描画品質を段階的に下げる判定（上げ直すと表示がちらつくので下げるだけ） */
export class AdaptiveQuality {
  private elapsed = 0;
  private frames = 0;

  constructor(
    private readonly windowSeconds = 2.5,
    private readonly minFps = 38,
  ) {}

  /** 1 フレームを記録し、計測期間ごとに「品質を下げるべきか」を返す */
  recordFrame(realDt: number): boolean {
    // タブ復帰直後などの極端に長いフレームは計測に入れない
    if (realDt <= 0 || realDt > 0.5) return false;
    this.elapsed += realDt;
    this.frames++;
    if (this.elapsed < this.windowSeconds) return false;
    const fps = this.frames / this.elapsed;
    this.elapsed = 0;
    this.frames = 0;
    return fps < this.minFps;
  }

  reset(): void {
    this.elapsed = 0;
    this.frames = 0;
  }
}
