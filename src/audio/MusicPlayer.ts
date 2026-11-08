import { MUSIC_TRACKS, type MusicNote, type MusicTrackId } from './MusicPatterns';

/** 先読みして予約する長さ（秒）とタイマーの間隔（ミリ秒） */
const SCHEDULE_AHEAD_SECONDS = 0.35;
const SCHEDULER_INTERVAL_MS = 100;
const FADE_SECONDS = 0.5;

/**
 * Web Audio API で BGM をその場で合成して流すプレイヤー。
 * 音源ファイルを持たないので、配信サイズを増やさずに鳴らせる。
 */
export class MusicPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private trackBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private requested: MusicTrackId | null = null;
  private playing: MusicTrackId | null = null;
  private volume = 0.5;
  private bar = 0;
  private nextBarTime = 0;

  /** ブラウザの制限により、最初のユーザー操作の後で呼ぶ */
  unlock(): void {
    if (this.ctx || typeof window === 'undefined' || !window.AudioContext) return;
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    this.noise = this.createNoise(this.ctx);
    // タブが裏にある間はタイマーが間引かれて音が崩れるので止めておく
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
    this.applyRequestedTrack();
  }

  setVolume(volume: number): void {
    this.volume = volume;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.02);
  }

  /** 流す曲を切り替える（null で停止） */
  setTrack(track: MusicTrackId | null): void {
    if (this.requested === track) return;
    this.requested = track;
    this.applyRequestedTrack();
  }

  private applyRequestedTrack(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.playing === this.requested) return;

    // 鳴っている曲はフェードアウトして切り離す
    if (this.trackBus) {
      const old = this.trackBus;
      old.gain.setTargetAtTime(0, ctx.currentTime, FADE_SECONDS / 3);
      setTimeout(() => old.disconnect(), (FADE_SECONDS + 0.4) * 1000);
      this.trackBus = null;
    }
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.playing = this.requested;
    if (!this.playing) return;

    this.trackBus = ctx.createGain();
    this.trackBus.connect(this.master);
    this.bar = 0;
    this.nextBarTime = ctx.currentTime + 0.08;
    this.scheduleBars();
    this.timer = setInterval(() => this.scheduleBars(), SCHEDULER_INTERVAL_MS);
  }

  private scheduleBars(): void {
    const ctx = this.ctx;
    if (!ctx || !this.playing || ctx.state !== 'running') {
      // 再開直後に過去の時刻へ大量に予約しないよう、基準時刻を送っておく
      if (ctx) this.nextBarTime = Math.max(this.nextBarTime, ctx.currentTime + 0.08);
      return;
    }
    const track = MUSIC_TRACKS[this.playing];
    const secondsPerBeat = 60 / track.bpm;
    while (this.nextBarTime < ctx.currentTime + SCHEDULE_AHEAD_SECONDS) {
      for (const note of track.buildBar(this.bar)) {
        this.scheduleNote(note, this.nextBarTime + note.beat * secondsPerBeat, note.length * secondsPerBeat);
      }
      this.nextBarTime += track.beatsPerBar * secondsPerBeat;
      this.bar = (this.bar + 1) % track.loopBars;
    }
  }

  private scheduleNote(note: MusicNote, at: number, duration: number): void {
    const ctx = this.ctx;
    const bus = this.trackBus;
    if (!ctx || !bus) return;
    const gain = ctx.createGain();
    gain.connect(bus);

    if (note.voice === 'hat' || note.voice === 'snare') {
      const source = ctx.createBufferSource();
      source.buffer = this.noise;
      const filter = ctx.createBiquadFilter();
      filter.type = note.voice === 'hat' ? 'highpass' : 'bandpass';
      filter.frequency.value = note.voice === 'hat' ? 7000 : 1800;
      source.connect(filter);
      filter.connect(gain);
      gain.gain.setValueAtTime(note.gain, at);
      gain.gain.exponentialRampToValueAtTime(0.001, at + duration);
      source.start(at);
      source.stop(at + duration + 0.02);
      return;
    }

    const osc = ctx.createOscillator();
    osc.connect(gain);
    if (note.voice === 'kick') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(130, at);
      osc.frequency.exponentialRampToValueAtTime(42, at + duration);
    } else {
      osc.type = note.voice;
      osc.frequency.value = note.freq;
    }
    // 立ち上がりと余韻でプツッというノイズが出ないようにする
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(note.gain, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, at + Math.max(0.05, duration));
    osc.start(at);
    osc.stop(at + Math.max(0.05, duration) + 0.02);
  }

  private createNoise(ctx: AudioContext): AudioBuffer {
    const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }
}
