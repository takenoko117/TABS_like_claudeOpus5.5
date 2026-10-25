import type { CombatEffectEvent } from '../combat/CombatSystem';

/**
 * Web Audio API を用いたプロシージャル効果音（SE）マネージャー。
 * 外部音声ファイルに依存せず、打撃音・斬撃音・弓矢発射音・ボクセル損壊音・UI操作音などをリアルタイム合成する。
 */
export class SoundManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  muted = false;
  volume = 0.55;

  /** 同じフレームで大量の音が重なって音割れするのを防ぐクールダウン記録 */
  private readonly lastPlayed = new Map<string, number>();

  private ensureContext(): AudioContext | null {
    if (this.muted) return null;
    if (typeof window === 'undefined') return null;
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!this.ctx) {
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.volume;
      this.masterGain.connect(this.ctx.destination);
      this.noiseBuffer = this.createNoiseBuffer(this.ctx);
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  private createNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const length = ctx.sampleRate * 1.0;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  private throttle(key: string, minIntervalMs: number): boolean {
    const now = performance.now();
    const prev = this.lastPlayed.get(key) ?? 0;
    if (now - prev < minIntervalMs) return false;
    this.lastPlayed.set(key, now);
    return true;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(muted ? 0 : this.volume, this.ctx.currentTime);
    }
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /** ユニット配置時のポップ音 */
  playPlace(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || !this.throttle('place', 25)) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    const pitch = 300 + Math.random() * 60;
    osc.frequency.setValueAtTime(pitch, t);
    osc.frequency.exponentialRampToValueAtTime(pitch * 1.65, t + 0.08);
    gain.gain.setValueAtTime(0.28, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.095);
  }

  /** ユニット削除時の下降音 */
  playRemove(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || !this.throttle('remove', 25)) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(340, t);
    osc.frequency.exponentialRampToValueAtTime(140, t + 0.1);
    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.12);
  }

  /** 戦闘開始の角笛風サウンド */
  playBattleStart(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const t = ctx.currentTime;
    const freqs = [196, 293.66, 392]; // G3, D4, G4
    freqs.forEach((f, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f * 0.97, t + idx * 0.04);
      osc.frequency.exponentialRampToValueAtTime(f, t + idx * 0.04 + 0.12);

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(900, t);

      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.14, t + 0.06 + idx * 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.65);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(t + idx * 0.04);
      osc.stop(t + 0.68);
    });
  }

  /** 勝敗決定時のファンファーレ */
  playVictory(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const t = ctx.currentTime;
    const notes = [261.63, 329.63, 392.0, 523.25]; // C4, E4, G4, C5
    notes.forEach((f, i) => {
      const start = t + i * 0.11;
      const dur = i === notes.length - 1 ? 0.55 : 0.16;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, start);
      gain.gain.setValueAtTime(0.22, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(start);
      osc.stop(start + dur + 0.02);
    });
  }

  /** 弓の発射音（弦の弾き＋風切り） */
  playBowShoot(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || !this.noiseBuffer || !this.throttle('bow', 45)) return;
    const t = ctx.currentTime;

    // 弦のトゥワング音
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = 'triangle';
    const base = 180 + Math.random() * 40;
    osc.frequency.setValueAtTime(base, t);
    osc.frequency.exponentialRampToValueAtTime(75, t + 0.11);
    oscGain.gain.setValueAtTime(0.2, t);
    oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.connect(oscGain);
    oscGain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.13);

    // 風切りノイズ
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1400, t);
    filter.frequency.exponentialRampToValueAtTime(2800, t + 0.09);
    filter.Q.value = 2.5;
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.18, t);
    nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(this.masterGain);
    noise.start(t);
    noise.stop(t + 0.11);
  }

  /**
   * 攻撃ヒット＆ボクセル損壊音。
   * @param heavy 巨人の棍棒など重い一撃か
   * @param metallic 剣・槍などの金属武器か
   * @param partBroken 部位破壊（または撃破）が発生したか
   */
  playHit(heavy: boolean, metallic: boolean, partBroken: boolean): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || !this.noiseBuffer || !this.throttle('hit', 28)) return;
    const t = ctx.currentTime;

    // 1. 低音の打撃インパクト
    const punch = ctx.createOscillator();
    const punchGain = ctx.createGain();
    punch.type = 'sine';
    const startFreq = heavy ? 130 : 175 + Math.random() * 35;
    const endFreq = heavy ? 32 : 48;
    const dur = heavy ? 0.22 : 0.13;
    punch.frequency.setValueAtTime(startFreq, t);
    punch.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    punchGain.gain.setValueAtTime(heavy ? 0.45 : 0.3, t);
    punchGain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    punch.connect(punchGain);
    punchGain.connect(this.masterGain);
    punch.start(t);
    punch.stop(t + dur + 0.01);

    // 2. 金属の斬撃／甲冑ヒット音
    if (metallic) {
      const clang = ctx.createOscillator();
      const clangGain = ctx.createGain();
      clang.type = 'square';
      const f = 920 + Math.random() * 380;
      clang.frequency.setValueAtTime(f, t);
      clang.frequency.exponentialRampToValueAtTime(f * 0.55, t + 0.08);
      clangGain.gain.setValueAtTime(0.12, t);
      clangGain.gain.exponentialRampToValueAtTime(0.001, t + 0.085);
      clang.connect(clangGain);
      clangGain.connect(this.masterGain);
      clang.start(t);
      clang.stop(t + 0.09);
    }

    // 3. ボクセルが砕け散るクラック音（短い連続ノイズバースト）
    const bursts = partBroken ? 4 : 2;
    for (let i = 0; i < bursts; i++) {
      const delay = i * (0.022 + Math.random() * 0.018);
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(700 + Math.random() * 1100, t + delay);
      bp.Q.value = 1.8;
      const g = ctx.createGain();
      const amp = (partBroken ? 0.28 : 0.16) * (1 - i * 0.18);
      g.gain.setValueAtTime(amp, t + delay);
      g.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.065);
      src.connect(bp);
      bp.connect(g);
      g.connect(this.masterGain);
      src.start(t + delay);
      src.stop(t + delay + 0.07);
    }
  }

  /** 新ユニット固有のスキル・武器・モンスター効果音を再生する */
  playEffect(e: CombatEffectEvent): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || !this.noiseBuffer) return;
    const t = ctx.currentTime;

    switch (e.kind) {
      case 'lightning': {
        if (!this.throttle('lightning', 70)) return;
        // 放電クラックノイズ＋落雷の重低音
        const noise = ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(2400, t);
        bp.Q.value = 1.4;
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(0.35, t);
        ng.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
        noise.connect(bp);
        bp.connect(ng);
        ng.connect(this.masterGain);
        noise.start(t);
        noise.stop(t + 0.26);

        const zap = ctx.createOscillator();
        const zg = ctx.createGain();
        zap.type = 'sawtooth';
        zap.frequency.setValueAtTime(680, t);
        zap.frequency.exponentialRampToValueAtTime(55, t + 0.24);
        zg.gain.setValueAtTime(0.28, t);
        zg.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
        zap.connect(zg);
        zg.connect(this.masterGain);
        zap.start(t);
        zap.stop(t + 0.26);
        break;
      }
      case 'gravity_pull': {
        if (!this.throttle('grav_pull', 120)) return;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(110, t);
        osc.frequency.exponentialRampToValueAtTime(42, t + 0.8);
        g.gain.setValueAtTime(0.01, t);
        g.gain.linearRampToValueAtTime(0.32, t + 0.25);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
        osc.connect(g);
        g.connect(this.masterGain);
        osc.start(t);
        osc.stop(t + 0.92);
        break;
      }
      case 'gravity_blast': {
        if (!this.throttle('grav_blast', 90)) return;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(190, t);
        osc.frequency.exponentialRampToValueAtTime(28, t + 0.38);
        g.gain.setValueAtTime(0.5, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
        osc.connect(g);
        g.connect(this.masterGain);
        osc.start(t);
        osc.stop(t + 0.42);
        break;
      }
      case 'sniper_shot': {
        if (!this.throttle('sniper', 80)) return;
        // 超音速銃声クラック
        const noise = ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.setValueAtTime(600, t);
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(0.45, t);
        ng.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
        noise.connect(hp);
        hp.connect(ng);
        ng.connect(this.masterGain);
        noise.start(t);
        noise.stop(t + 0.24);

        const boom = ctx.createOscillator();
        const bg = ctx.createGain();
        boom.type = 'sawtooth';
        boom.frequency.setValueAtTime(240, t);
        boom.frequency.exponentialRampToValueAtTime(38, t + 0.2);
        bg.gain.setValueAtTime(0.4, t);
        bg.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
        boom.connect(bg);
        bg.connect(this.masterGain);
        boom.start(t);
        boom.stop(t + 0.23);
        break;
      }
      case 'minigun_spin': {
        if (!this.throttle('mg_spin', 120)) return;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(90, t);
        osc.frequency.exponentialRampToValueAtTime(340, t + 0.55);
        g.gain.setValueAtTime(0.01, t);
        g.gain.linearRampToValueAtTime(0.16, t + 0.4);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
        osc.connect(g);
        g.connect(this.masterGain);
        osc.start(t);
        osc.stop(t + 0.62);
        break;
      }
      case 'minigun_shot': {
        if (!this.throttle('mg_shot', 55)) return;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(210 + Math.random() * 40, t);
        osc.frequency.exponentialRampToValueAtTime(65, t + 0.055);
        g.gain.setValueAtTime(0.18, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
        osc.connect(g);
        g.connect(this.masterGain);
        osc.start(t);
        osc.stop(t + 0.065);
        break;
      }
      case 'minigun_steam': {
        if (!this.throttle('mg_steam', 150)) return;
        const noise = ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.setValueAtTime(2800, t);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.18, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
        noise.connect(hp);
        hp.connect(g);
        g.connect(this.masterGain);
        noise.start(t);
        noise.stop(t + 0.36);
        break;
      }
      case 'iaido_charge': {
        if (!this.throttle('iaido_chg', 100)) return;
        // 鯉口を切る「チャキッ」という金属音
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1850, t);
        osc.frequency.exponentialRampToValueAtTime(2900, t + 0.07);
        g.gain.setValueAtTime(0.18, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
        osc.connect(g);
        g.connect(this.masterGain);
        osc.start(t);
        osc.stop(t + 0.09);
        break;
      }
      case 'iaido_dash': {
        if (!this.throttle('iaido_dash', 80)) return;
        const noise = ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(900, t);
        bp.frequency.exponentialRampToValueAtTime(3400, t + 0.14);
        bp.Q.value = 2.0;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.32, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
        noise.connect(bp);
        bp.connect(g);
        g.connect(this.masterGain);
        noise.start(t);
        noise.stop(t + 0.17);
        break;
      }
      case 'iaido_burst': {
        if (!this.throttle('iaido_burst', 60)) return;
        // 納刀の「チン…」という高音と斬撃の同時炸裂
        const chime = ctx.createOscillator();
        const cg = ctx.createGain();
        chime.type = 'sine';
        chime.frequency.setValueAtTime(2400, t);
        chime.frequency.exponentialRampToValueAtTime(1600, t + 0.18);
        cg.gain.setValueAtTime(0.22, t);
        cg.gain.exponentialRampToValueAtTime(0.001, t + 0.19);
        chime.connect(cg);
        cg.connect(this.masterGain);
        chime.start(t);
        chime.stop(t + 0.2);
        break;
      }
      case 'shuriken_throw': {
        if (!this.throttle('shuriken', 60)) return;
        for (let i = 0; i < 3; i++) {
          const d = i * 0.03;
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(1200 + i * 220, t + d);
          osc.frequency.exponentialRampToValueAtTime(420, t + d + 0.05);
          g.gain.setValueAtTime(0.15, t + d);
          g.gain.exponentialRampToValueAtTime(0.001, t + d + 0.055);
          osc.connect(g);
          g.connect(this.masterGain);
          osc.start(t + d);
          osc.stop(t + d + 0.06);
        }
        break;
      }
      case 'ninja_kawari': {
        if (!this.throttle('kawari', 90)) return;
        // 煙玉の「ポンッ！」という破裂音
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(420, t);
        osc.frequency.exponentialRampToValueAtTime(130, t + 0.11);
        g.gain.setValueAtTime(0.34, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
        osc.connect(g);
        g.connect(this.masterGain);
        osc.start(t);
        osc.stop(t + 0.13);
        break;
      }
      case 'elephant_roar': {
        if (!this.throttle('elephant_roar', 200)) return;
        // 象の「パオォォーン！」というブラス咆哮
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(220, t);
        osc.frequency.exponentialRampToValueAtTime(440, t + 0.15);
        osc.frequency.exponentialRampToValueAtTime(290, t + 0.45);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(1200, t);
        g.gain.setValueAtTime(0.28, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.48);
        osc.connect(lp);
        lp.connect(g);
        g.connect(this.masterGain);
        osc.start(t);
        osc.stop(t + 0.5);
        break;
      }
      case 'elephant_step':
      case 'eagle_drop_impact': {
        if (!this.throttle('heavy_step', 90)) return;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(95, t);
        osc.frequency.exponentialRampToValueAtTime(28, t + 0.18);
        g.gain.setValueAtTime(e.kind === 'eagle_drop_impact' ? 0.42 : 0.22, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.19);
        osc.connect(g);
        g.connect(this.masterGain);
        osc.start(t);
        osc.stop(t + 0.2);
        break;
      }
      case 'eagle_cry': {
        if (!this.throttle('eagle_cry', 180)) return;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(1650, t);
        osc.frequency.exponentialRampToValueAtTime(2200, t + 0.08);
        osc.frequency.exponentialRampToValueAtTime(1250, t + 0.26);
        g.gain.setValueAtTime(0.22, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
        osc.connect(g);
        g.connect(this.masterGain);
        osc.start(t);
        osc.stop(t + 0.29);
        break;
      }
      case 'dragon_roar': {
        if (!this.throttle('dragon_roar', 220)) return;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(140, t);
        osc.frequency.exponentialRampToValueAtTime(72, t + 0.45);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(650, t);
        g.gain.setValueAtTime(0.32, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.48);
        osc.connect(lp);
        lp.connect(g);
        g.connect(this.masterGain);
        osc.start(t);
        osc.stop(t + 0.5);
        break;
      }
      case 'dragon_breath': {
        if (!this.throttle('dragon_breath', 110)) return;
        const noise = ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(480, t);
        bp.Q.value = 1.1;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.2, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
        noise.connect(bp);
        bp.connect(g);
        g.connect(this.masterGain);
        noise.start(t);
        noise.stop(t + 0.17);
        break;
      }
      case 'slime_jump':
      case 'slime_slam':
      case 'slime_split': {
        if (!this.throttle('slime', 70)) return;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        if (e.kind === 'slime_jump') {
          osc.frequency.setValueAtTime(160, t);
          osc.frequency.exponentialRampToValueAtTime(420, t + 0.16);
        } else if (e.kind === 'slime_slam') {
          osc.frequency.setValueAtTime(320, t);
          osc.frequency.exponentialRampToValueAtTime(95, t + 0.18);
        } else {
          osc.frequency.setValueAtTime(240, t);
          osc.frequency.exponentialRampToValueAtTime(580, t + 0.14);
        }
        g.gain.setValueAtTime(0.28, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.19);
        osc.connect(g);
        g.connect(this.masterGain);
        osc.start(t);
        osc.stop(t + 0.2);
        break;
      }
      case 'buggy_ram': {
        if (!this.throttle('buggy_ram', 90)) return;
        // バギー激突音: ガシャーンという金属クラッシュと重低音
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(220, t);
        osc.frequency.exponentialRampToValueAtTime(45, t + 0.22);
        g.gain.setValueAtTime(0.35, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
        osc.connect(g);
        g.connect(this.masterGain);
        osc.start(t);
        osc.stop(t + 0.25);
        break;
      }
      case 'buggy_smoke': {
        if (!this.throttle('buggy_smoke', 140)) return;
        // タイヤ摩擦音
        const noise = ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const bp = ctx.createBiquadFilter();
        const g = ctx.createGain();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(800, t);
        bp.Q.setValueAtTime(2.0, t);
        g.gain.setValueAtTime(0.12, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
        noise.connect(bp);
        bp.connect(g);
        g.connect(this.masterGain);
        noise.start(t);
        noise.stop(t + 0.12);
        break;
      }
      case 'anaconda_hiss': {
        if (!this.throttle('anaconda_hiss', 200)) return;
        // アナコンダのシャーッという威嚇音
        const noise = ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const bp = ctx.createBiquadFilter();
        const g = ctx.createGain();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(2800, t);
        bp.frequency.exponentialRampToValueAtTime(1400, t + 0.24);
        bp.Q.setValueAtTime(3.5, t);
        g.gain.setValueAtTime(0.2, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
        noise.connect(bp);
        bp.connect(g);
        g.connect(this.masterGain);
        noise.start(t);
        noise.stop(t + 0.25);
        break;
      }
      case 'anaconda_bite': {
        if (!this.throttle('anaconda_bite', 80)) return;
        // 毒牙の噛みつき音
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(360, t);
        osc.frequency.exponentialRampToValueAtTime(85, t + 0.12);
        g.gain.setValueAtTime(0.3, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
        osc.connect(g);
        g.connect(this.masterGain);
        osc.start(t);
        osc.stop(t + 0.15);
        break;
      }
      case 'decoy_pop': {
        if (!this.throttle('decoy_pop', 80)) return;
        // おとり破壊時のパフッという藁破裂音
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(280, t);
        osc.frequency.exponentialRampToValueAtTime(90, t + 0.15);
        g.gain.setValueAtTime(0.32, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
        osc.connect(g);
        g.connect(this.masterGain);
        osc.start(t);
        osc.stop(t + 0.17);
        break;
      }
      case 'shield_block': {
        if (!this.throttle('shield_blk', 55)) return;
        // 鉄盾が矢や刃を弾く硬質な金属反響音
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(1150 + Math.random() * 250, t);
        osc.frequency.exponentialRampToValueAtTime(420, t + 0.11);
        g.gain.setValueAtTime(0.24, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
        osc.connect(g);
        g.connect(this.masterGain);
        osc.start(t);
        osc.stop(t + 0.13);
        break;
      }
      case 'charge_leap':
      case 'bomb_throw': {
        if (!this.throttle('whoosh_act', 70)) return;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(180, t);
        osc.frequency.exponentialRampToValueAtTime(360, t + 0.12);
        g.gain.setValueAtTime(0.18, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
        osc.connect(g);
        g.connect(this.masterGain);
        osc.start(t);
        osc.stop(t + 0.14);
        break;
      }
      case 'bomb_explosion': {
        if (!this.throttle('bomb_exp', 80)) return;
        // 重低音の爆発音＋爆風ノイズ
        const boom = ctx.createOscillator();
        const bg = ctx.createGain();
        boom.type = 'sine';
        boom.frequency.setValueAtTime(150, t);
        boom.frequency.exponentialRampToValueAtTime(24, t + 0.38);
        bg.gain.setValueAtTime(0.5, t);
        bg.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
        boom.connect(bg);
        bg.connect(this.masterGain);
        boom.start(t);
        boom.stop(t + 0.42);

        const noise = ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(950, t);
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(0.38, t);
        ng.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
        noise.connect(lp);
        lp.connect(ng);
        ng.connect(this.masterGain);
        noise.start(t);
        noise.stop(t + 0.36);
        break;
      }
      case 'portal_spawn': {
        if (!this.throttle('portal_sp', 120)) return;
        // 召喚ポータルのミスティックな召喚音
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(220, t);
        osc.frequency.exponentialRampToValueAtTime(680, t + 0.18);
        g.gain.setValueAtTime(0.28, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
        osc.connect(g);
        g.connect(this.masterGain);
        osc.start(t);
        osc.stop(t + 0.24);
        break;
      }
      case 'totem_pulse': {
        if (!this.throttle('totem_pls', 150)) return;
        // 加護のトーテムの鐘のような共鳴音
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(520, t);
        osc.frequency.exponentialRampToValueAtTime(390, t + 0.35);
        g.gain.setValueAtTime(0.22, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
        osc.connect(g);
        g.connect(this.masterGain);
        osc.start(t);
        osc.stop(t + 0.4);
        break;
      }
      case 'gate_multiply': {
        if (!this.throttle('gate_mult', 90)) return;
        // 増殖ゲートの複製キラキラ音
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const g = ctx.createGain();
        osc1.type = 'sine';
        osc2.type = 'triangle';
        osc1.frequency.setValueAtTime(440, t);
        osc1.frequency.exponentialRampToValueAtTime(880, t + 0.15);
        osc2.frequency.setValueAtTime(660, t);
        osc2.frequency.exponentialRampToValueAtTime(1320, t + 0.15);
        g.gain.setValueAtTime(0.25, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
        osc1.connect(g);
        osc2.connect(g);
        g.connect(this.masterGain);
        osc1.start(t);
        osc2.start(t);
        osc1.stop(t + 0.22);
        osc2.stop(t + 0.22);
        break;
      }
      case 'cannon_fire': {
        if (!this.throttle('cannon_fr', 100)) return;
        // キャノン砲の重砲撃音
        const boom = ctx.createOscillator();
        const bg = ctx.createGain();
        boom.type = 'sine';
        boom.frequency.setValueAtTime(180, t);
        boom.frequency.exponentialRampToValueAtTime(32, t + 0.25);
        bg.gain.setValueAtTime(0.48, t);
        bg.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
        boom.connect(bg);
        bg.connect(this.masterGain);
        boom.start(t);
        boom.stop(t + 0.3);

        const noise = ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(1200, t);
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(0.4, t);
        ng.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
        noise.connect(lp);
        lp.connect(ng);
        ng.connect(this.masterGain);
        noise.start(t);
        noise.stop(t + 0.22);
        break;
      }
      case 'facility_destroy': {
        if (!this.throttle('fac_dst', 100)) return;
        // 建造物の轟音破壊音
        const boom = ctx.createOscillator();
        const bg = ctx.createGain();
        boom.type = 'triangle';
        boom.frequency.setValueAtTime(120, t);
        boom.frequency.exponentialRampToValueAtTime(20, t + 0.45);
        bg.gain.setValueAtTime(0.55, t);
        bg.gain.exponentialRampToValueAtTime(0.001, t + 0.48);
        boom.connect(bg);
        bg.connect(this.masterGain);
        boom.start(t);
        boom.stop(t + 0.5);

        const noise = ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(750, t);
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(0.5, t);
        ng.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
        noise.connect(lp);
        lp.connect(ng);
        ng.connect(this.masterGain);
        noise.start(t);
        noise.stop(t + 0.48);
        break;
      }
      case 'tank_fire': {
        if (!this.throttle('tank_fr', 100)) return;
        // 超巨大戦車の重砲撃音（超低音ドォォン）
        const boom = ctx.createOscillator();
        const bg = ctx.createGain();
        boom.type = 'sine';
        boom.frequency.setValueAtTime(150, t);
        boom.frequency.exponentialRampToValueAtTime(24, t + 0.35);
        bg.gain.setValueAtTime(0.6, t);
        bg.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
        boom.connect(bg);
        bg.connect(this.masterGain);
        boom.start(t);
        boom.stop(t + 0.4);

        const noise = ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(900, t);
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(0.55, t);
        ng.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
        noise.connect(lp);
        lp.connect(ng);
        ng.connect(this.masterGain);
        noise.start(t);
        noise.stop(t + 0.3);
        break;
      }
      case 'tank_explosion': {
        if (!this.throttle('tank_exp', 80)) return;
        // 戦車榴弾の大轟音爆発
        const boom = ctx.createOscillator();
        const bg = ctx.createGain();
        boom.type = 'triangle';
        boom.frequency.setValueAtTime(130, t);
        boom.frequency.exponentialRampToValueAtTime(18, t + 0.48);
        bg.gain.setValueAtTime(0.65, t);
        bg.gain.exponentialRampToValueAtTime(0.001, t + 0.52);
        boom.connect(bg);
        bg.connect(this.masterGain);
        boom.start(t);
        boom.stop(t + 0.55);

        const noise = ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(1100, t);
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(0.6, t);
        ng.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
        noise.connect(lp);
        lp.connect(ng);
        ng.connect(this.masterGain);
        noise.start(t);
        noise.stop(t + 0.45);
        break;
      }
      case 'rocket_fire': {
        if (!this.throttle('rkt_fr', 60)) return;
        // ロケット発射・噴射音（シュオォォン）
        const noise = ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(800, t);
        bp.frequency.exponentialRampToValueAtTime(1600, t + 0.15);
        bp.Q.value = 2.0;
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(0.45, t);
        ng.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
        noise.connect(bp);
        bp.connect(ng);
        ng.connect(this.masterGain);
        noise.start(t);
        noise.stop(t + 0.3);
        break;
      }
      case 'rocket_explosion': {
        if (!this.throttle('rkt_exp', 60)) return;
        // ロケット弾爆発音
        const boom = ctx.createOscillator();
        const bg = ctx.createGain();
        boom.type = 'triangle';
        boom.frequency.setValueAtTime(160, t);
        boom.frequency.exponentialRampToValueAtTime(30, t + 0.3);
        bg.gain.setValueAtTime(0.5, t);
        bg.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
        boom.connect(bg);
        bg.connect(this.masterGain);
        boom.start(t);
        boom.stop(t + 0.35);

        const noise = ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(1200, t);
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(0.48, t);
        ng.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
        noise.connect(lp);
        lp.connect(ng);
        ng.connect(this.masterGain);
        noise.start(t);
        noise.stop(t + 0.28);
        break;
      }
      case 'satellite_target': {
        if (!this.throttle('sat_tgt', 180)) return;
        // 衛星照準ピピピッ音
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1400, t);
        osc.frequency.setValueAtTime(1750, t + 0.04);
        g.gain.setValueAtTime(0.2, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
        osc.connect(g);
        g.connect(this.masterGain);
        osc.start(t);
        osc.stop(t + 0.09);
        break;
      }
      case 'satellite_beam': {
        if (!this.throttle('sat_beam', 150)) return;
        // 軌道衛星からの荷電粒子ビーム照射音（高エネルギー地鳴り）
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(600, t);
        osc.frequency.exponentialRampToValueAtTime(45, t + 0.4);
        g.gain.setValueAtTime(0.5, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
        osc.connect(g);
        g.connect(this.masterGain);
        osc.start(t);
        osc.stop(t + 0.48);

        const noise = ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(1600, t);
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(0.65, t);
        ng.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
        noise.connect(lp);
        lp.connect(ng);
        ng.connect(this.masterGain);
        noise.start(t);
        noise.stop(t + 0.52);
        break;
      }
      case 'robot_punch_fire': {
        if (!this.throttle('rbt_pnc_fr', 80)) return;
        // ロケットパンチ射出音（機械駆動音＋ブースター噴射音）
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(320, t);
        osc.frequency.exponentialRampToValueAtTime(80, t + 0.22);
        g.gain.setValueAtTime(0.35, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
        osc.connect(g);
        g.connect(this.masterGain);
        osc.start(t);
        osc.stop(t + 0.26);

        const noise = ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(700, t);
        bp.frequency.exponentialRampToValueAtTime(1400, t + 0.2);
        bp.Q.value = 1.8;
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(0.5, t);
        ng.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        noise.connect(bp);
        bp.connect(ng);
        ng.connect(this.masterGain);
        noise.start(t);
        noise.stop(t + 0.32);
        break;
      }
      case 'at_field': {
        if (!this.throttle('at_fld', 100)) return;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, t);
        osc.frequency.exponentialRampToValueAtTime(180, t + 0.18);
        g.gain.setValueAtTime(0.35, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
        osc.connect(g);
        g.connect(this.masterGain);
        osc.start(t);
        osc.stop(t + 0.24);
        break;
      }
      case 'ramiel_charge': {
        if (!this.throttle('ram_chg', 180)) return;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(950, t);
        osc.frequency.exponentialRampToValueAtTime(2400, t + 0.35);
        g.gain.setValueAtTime(0.25, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
        osc.connect(g);
        g.connect(this.masterGain);
        osc.start(t);
        osc.stop(t + 0.4);
        break;
      }
      case 'ramiel_beam': {
        if (!this.throttle('ram_beam', 150)) return;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(750, t);
        osc.frequency.exponentialRampToValueAtTime(35, t + 0.5);
        g.gain.setValueAtTime(0.65, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
        osc.connect(g);
        g.connect(this.masterGain);
        osc.start(t);
        osc.stop(t + 0.58);

        const noise = ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(1800, t);
        bp.Q.value = 2.5;
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(0.6, t);
        ng.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
        noise.connect(bp);
        bp.connect(ng);
        ng.connect(this.masterGain);
        noise.start(t);
        noise.stop(t + 0.48);
        break;
      }
      case 'sachiel_pile': {
        if (!this.throttle('sac_pile', 80)) return;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(680, t);
        osc.frequency.exponentialRampToValueAtTime(90, t + 0.15);
        g.gain.setValueAtTime(0.4, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
        osc.connect(g);
        g.connect(this.masterGain);
        osc.start(t);
        osc.stop(t + 0.2);
        break;
      }
      case 'sachiel_cross': {
        if (!this.throttle('sac_cross', 120)) return;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(280, t);
        osc.frequency.exponentialRampToValueAtTime(40, t + 0.35);
        g.gain.setValueAtTime(0.55, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
        osc.connect(g);
        g.connect(this.masterGain);
        osc.start(t);
        osc.stop(t + 0.42);
        break;
      }
      case 'zeruel_ribbon': {
        if (!this.throttle('zer_rib', 80)) return;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(800, t);
        osc.frequency.exponentialRampToValueAtTime(140, t + 0.12);
        g.gain.setValueAtTime(0.45, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
        osc.connect(g);
        g.connect(this.masterGain);
        osc.start(t);
        osc.stop(t + 0.18);
        break;
      }
      case 'sahaquiel_bomb': {
        if (!this.throttle('sah_bmb', 100)) return;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(190, t);
        osc.frequency.exponentialRampToValueAtTime(30, t + 0.45);
        g.gain.setValueAtTime(0.6, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
        osc.connect(g);
        g.connect(this.masterGain);
        osc.start(t);
        osc.stop(t + 0.52);

        const noise = ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(1100, t);
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(0.55, t);
        ng.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
        noise.connect(lp);
        lp.connect(ng);
        ng.connect(this.masterGain);
        noise.start(t);
        noise.stop(t + 0.45);
        break;
      }
      case 'robot_punch_impact': {
        if (!this.throttle('rbt_pnc_imp', 80)) return;
        // 超重量金属ナックルの直撃・轟音インパクト爆発
        const boom = ctx.createOscillator();
        const bg = ctx.createGain();
        boom.type = 'triangle';
        boom.frequency.setValueAtTime(160, t);
        boom.frequency.exponentialRampToValueAtTime(22, t + 0.45);
        bg.gain.setValueAtTime(0.7, t);
        bg.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
        boom.connect(bg);
        bg.connect(this.masterGain);
        boom.start(t);
        boom.stop(t + 0.52);

        // 金属衝撃打撃音
        const clank = ctx.createOscillator();
        const cg = ctx.createGain();
        clank.type = 'square';
        clank.frequency.setValueAtTime(540, t);
        clank.frequency.exponentialRampToValueAtTime(110, t + 0.15);
        cg.gain.setValueAtTime(0.4, t);
        cg.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
        clank.connect(cg);
        cg.connect(this.masterGain);
        clank.start(t);
        clank.stop(t + 0.2);

        const noise = ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(1300, t);
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(0.6, t);
        ng.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
        noise.connect(lp);
        lp.connect(ng);
        ng.connect(this.masterGain);
        noise.start(t);
        noise.stop(t + 0.4);
        break;
      }
    }
  }
}
