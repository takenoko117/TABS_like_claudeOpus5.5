import { describe, expect, it } from 'vitest';
import { MUSIC_TRACKS, type MusicTrackId } from '../src/audio/MusicPatterns';
import { AdaptiveQuality, DEFAULT_SETTINGS, parseSettings } from '../src/game/Settings';

describe('設定データ', () => {
  it('不正な値は既定値に戻し、音量は範囲内に収める', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{oops')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('[]')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(JSON.stringify({ musicVolume: 3, sfxVolume: -1, quality: 'ultra' }))).toEqual({
      musicVolume: 1,
      sfxVolume: 0,
      quality: DEFAULT_SETTINGS.quality,
    });
  });

  it('正しい設定はそのまま読み込む', () => {
    const settings = { musicVolume: 0.2, sfxVolume: 0.8, quality: 'low' };
    expect(parseSettings(JSON.stringify(settings))).toEqual(settings);
  });
});

describe('描画品質の自動調整', () => {
  it('低フレームレートが続くと品質低下を要求する', () => {
    const q = new AdaptiveQuality(1, 40);
    let lowered = false;
    for (let i = 0; i < 30; i++) lowered = q.recordFrame(1 / 20) || lowered;
    expect(lowered).toBe(true);
  });

  it('十分なフレームレートなら要求しない', () => {
    const q = new AdaptiveQuality(1, 40);
    let lowered = false;
    for (let i = 0; i < 200; i++) lowered = q.recordFrame(1 / 60) || lowered;
    expect(lowered).toBe(false);
  });

  it('タブ復帰直後の極端に長いフレームは無視する', () => {
    const q = new AdaptiveQuality(1, 40);
    expect(q.recordFrame(5)).toBe(false);
  });
});

describe('BGM データ', () => {
  it.each(Object.keys(MUSIC_TRACKS) as MusicTrackId[])('%s の全音符が小節内に収まり値が正しい', (id) => {
    const track = MUSIC_TRACKS[id];
    for (let bar = 0; bar < track.loopBars; bar++) {
      const notes = track.buildBar(bar);
      expect(notes.length).toBeGreaterThan(0);
      for (const note of notes) {
        expect(note.beat).toBeGreaterThanOrEqual(0);
        expect(note.beat + note.length).toBeLessThanOrEqual(track.beatsPerBar + 0.001);
        expect(note.gain).toBeGreaterThan(0);
        expect(note.gain).toBeLessThanOrEqual(1);
        expect(Number.isFinite(note.freq)).toBe(true);
      }
    }
  });
});
