import { describe, expect, it } from 'vitest';
import { BannerQueue } from '../src/fx/BannerQueue';
import { CameraFx, smoothNoise } from '../src/fx/CameraFx';
import {
  FX_BANNER_DURATION,
  FX_COMBO_WINDOW,
  FX_CUES,
  FX_EFFECT_CUES,
  FX_FLASH_MAX_PER_SECOND,
  FX_HITSTOP_MAX,
  FX_HITSTOP_MIN_GAP,
  FX_SHAKE_MAX_OFFSET,
  FX_TRAUMA_DECAY,
  type FxCueId,
  type FxTier,
} from '../src/fx/FxCues';
import { FxDirector } from '../src/fx/FxDirector';
import { FrameProbe } from '../src/fx/FrameProbe';
import { TimeFx } from '../src/fx/TimeFx';
import { LagGauge, LAG_BAR_HOLD } from '../src/fx/ui/LagBar';
import { NumberTween } from '../src/fx/ui/TweenNumber';

const TIERS: FxTier[] = [0, 1, 2, 3];

describe('演出の表（FX_CUES）', () => {
  it('tier が上がるほど各チャンネルの値は弱くならない', () => {
    for (const [id, cue] of Object.entries(FX_CUES)) {
      for (const key of ['shake', 'kick', 'zoomPunch', 'hitStop', 'slow', 'unitFlash'] as const) {
        const v = cue[key];
        if (!v) continue;
        for (let t = 1; t < 4; t++) expect(v[t], `${id}.${key}[${t}]`).toBeGreaterThanOrEqual(v[t - 1]);
      }
    }
  });

  it('小ヒットはユニットのフラッシュだけで、画面は揺らさない（決定事項 R1）', () => {
    const hit = FX_CUES.unit_hit;
    expect(hit.unitFlash?.[0]).toBeGreaterThan(0);
    expect(hit.shake).toBeUndefined();
    expect(hit.hitStop).toBeUndefined();
    expect(FX_CUES.heavy_hit.shake?.[0]).toBeGreaterThan(0);
  });

  it('従来の揺れる戦闘エフェクトはすべて表に載っている', () => {
    for (const kind of ['bomb_explosion', 'tank_explosion', 'yamamuron_awaken', 'stage_meteor_impact', 'facility_destroy']) {
      expect(FX_EFFECT_CUES[kind], kind).toBeDefined();
    }
  });
});

describe('FxDirector: tier と強さの設定', () => {
  it('emit は表の値どおりに各チャンネルを動かす', () => {
    const fx = new FxDirector('full');
    for (const tier of TIERS) {
      fx.reset();
      const a = fx.emit('explosion', { tier, dir: { x: 1, z: 0 } })!;
      expect(a.shake).toBeCloseTo(FX_CUES.explosion.shake![tier]);
      expect(a.kick).toBeCloseTo(FX_CUES.explosion.kick![tier]);
      expect(a.zoomPunch).toBeCloseTo(FX_CUES.explosion.zoomPunch![tier]);
      expect(a.hitStop).toBeCloseTo(FX_CUES.explosion.hitStop![tier]);
      expect(fx.camera.trauma).toBeCloseTo(FX_CUES.explosion.shake![tier]);
    }
  });

  it('フル → 控えめ → 最小 の順に値が下がり、最小では揺れ・フラッシュ・ヒットストップがない', () => {
    const levels = ['full', 'reduced', 'minimal'] as const;
    const results = levels.map((lv) => new FxDirector(lv).resolve(FX_CUES.finish, 3));
    for (const key of ['shake', 'kick', 'zoomPunch', 'hitStop'] as const) {
      expect(results[1][key]).toBeLessThanOrEqual(results[0][key]);
      expect(results[2][key]).toBe(0);
    }
    // 控えめ: 揺れ幅（trauma²）は 50%、ズームパンチなし、フラッシュは縁だけ
    expect((results[1].shake / results[0].shake) ** 2).toBeCloseTo(0.5);
    expect(results[1].zoomPunch).toBe(0);
    expect(results[1].flash).toBeNull();
    expect(new FxDirector('reduced').resolve(FX_CUES.castle_hit, 2).flash).toBe('red-edge');
    expect(results[2].flash).toBeNull();
  });

  it('揺れだけ切る設定では揺れとキックだけが 0 になる', () => {
    const fx = new FxDirector('full', false);
    const a = fx.resolve(FX_CUES.boss_down, 2);
    expect(a.shake).toBe(0);
    expect(a.kick).toBe(0);
    expect(a.hitStop).toBeGreaterThan(0);
    fx.addShake(0.8);
    expect(fx.camera.trauma).toBe(0);
  });

  it('一時的に最小にしている間（観戦の追いつき・タイトル）は音も鳴らさない', () => {
    const sounds: string[] = [];
    const fx = new FxDirector('full');
    fx.sinks.sound = (name) => sounds.push(name);
    fx.suppressed = true;
    expect(fx.emit('castle_hit', { tier: 2 })!.shake).toBe(0);
    expect(sounds).toEqual([]);
    fx.suppressed = false;
    fx.update(1);
    fx.emit('castle_hit', { tier: 2 });
    expect(sounds).toEqual(['castle_hit']);
  });

  it('クールダウン中の同じ演出は無視し、間隔をあければまた出る', () => {
    const fx = new FxDirector('full');
    const cd = FX_CUES.castle_hit.cooldown!;
    expect(fx.emit('castle_hit', { tier: 1 })).not.toBeNull();
    fx.update(cd * 0.5);
    expect(fx.emit('castle_hit', { tier: 1 })).toBeNull();
    fx.update(cd * 0.6);
    expect(fx.emit('castle_hit', { tier: 1 })).not.toBeNull();
    // 別の演出はクールダウンを共有しない
    expect(fx.emit('explosion', { tier: 1 })).not.toBeNull();
  });

  it('フラッシュは 1 秒に 3 回まで', () => {
    // クールダウンを超える間隔で 1 秒間に何度も要求する
    const fresh = new FxDirector('full');
    let n = 0;
    fresh.sinks.flash = () => n++;
    for (let i = 0; i < 7; i++) {
      fresh.emit('castle_hit', { tier: 3 });
      fresh.update(0.13);
    }
    // 0.91 秒で 7 回要求 → 3 回だけ
    expect(n).toBe(FX_FLASH_MAX_PER_SECOND);
  });

  it('被弾したユニットの白フラッシュを差し込み口へ渡す', () => {
    const fx = new FxDirector('full');
    const got: Array<[number, number]> = [];
    fx.sinks.unitFlash = (id, s) => got.push([id, s]);
    fx.emit('unit_hit', { tier: 0, unitId: 7 });
    expect(got).toEqual([[7, FX_CUES.unit_hit.unitFlash![0]]]);
  });

  it('連続撃破は数が増えて音程が上がり、時間がたつと途切れる', () => {
    const fx = new FxDirector();
    expect(fx.registerKill().count).toBe(1);
    fx.update(0.3);
    const second = fx.registerKill();
    fx.update(0.3);
    const third = fx.registerKill();
    expect(third.count).toBe(3);
    expect(third.pitch).toBeGreaterThan(second.pitch);
    fx.update(FX_COMBO_WINDOW + 0.01);
    expect(fx.combo.count).toBe(0);
    expect(fx.registerKill().count).toBe(1);
  });
});

describe('CameraFx: トラウマ式の揺れ', () => {
  it('トラウマは足し算で溜まり、上限 1 で止まる', () => {
    const cam = new CameraFx();
    cam.addTrauma(0.3);
    cam.addTrauma(0.3);
    expect(cam.trauma).toBeCloseTo(0.6);
    cam.addTrauma(5);
    expect(cam.trauma).toBe(1);
  });

  it('揺れ幅は trauma² になる', () => {
    const cam = new CameraFx();
    cam.addTrauma(0.5);
    expect(cam.shakeAmount).toBeCloseTo(0.25);
    cam.trauma = 0.9;
    expect(cam.shakeAmount).toBeCloseTo(0.81);
  });

  it('時間とともに一定の速さで減り、0 で止まる', () => {
    const cam = new CameraFx();
    cam.addTrauma(0.8);
    cam.update(0.1);
    expect(cam.trauma).toBeCloseTo(0.8 - FX_TRAUMA_DECAY * 0.1);
    cam.update(5);
    expect(cam.trauma).toBe(0);
    expect(cam.active).toBe(false);
  });

  it('揺れのずれは最大幅に収まり、滑らかに変わる', () => {
    const cam = new CameraFx();
    let prev: number | null = null;
    let maxJump = 0;
    for (let i = 0; i < 120; i++) {
      cam.trauma = 1;
      cam.update(1 / 120);
      const o = cam.offset();
      expect(Math.abs(o.x)).toBeLessThanOrEqual(FX_SHAKE_MAX_OFFSET + 1e-9);
      if (prev !== null) maxJump = Math.max(maxJump, Math.abs(o.x - prev));
      prev = o.x;
    }
    // ランダムに飛ぶのではなく、1 フレームの変化は最大幅の半分未満
    expect(maxJump).toBeLessThan(FX_SHAKE_MAX_OFFSET * 0.5);
    for (let t = 0; t < 10; t += 0.37) expect(Math.abs(smoothNoise(t, 3))).toBeLessThanOrEqual(1);
  });

  it('方向キックは衝撃の向きに押してからばねで戻る', () => {
    const cam = new CameraFx();
    cam.kick(1, 0, 0.2);
    cam.update(1 / 60);
    expect(cam.offset().x).toBeGreaterThan(0);
    expect(Math.abs(cam.offset().z)).toBeLessThan(1e-9);
    for (let i = 0; i < 120; i++) cam.update(1 / 60);
    expect(Math.abs(cam.offset().x)).toBeLessThan(1e-3);
  });

  it('ズームパンチは FOV を一瞬狭めて戻す', () => {
    const cam = new CameraFx();
    cam.zoomPunch(0.06);
    cam.update(1 / 60);
    expect(cam.offset().fovScale).toBeLessThan(1);
    for (let i = 0; i < 120; i++) cam.update(1 / 60);
    expect(cam.offset().fovScale).toBeCloseTo(1, 3);
  });
});

describe('TimeFx: ヒットストップとスロー', () => {
  it('対戦中（戦場ストップ不可）は、ヒットストップ・スローを要求しても戦場の時間は止まらない', () => {
    const t = new TimeFx();
    t.hitStop(0.1);
    t.slow(1, 0.3);
    expect(t.frozen).toBe(true);
    expect(t.battleScale(false)).toBe(1);
    // 1 人用モードなら戦場ごと止まる
    expect(t.battleScale(true)).toBe(0);
  });

  it('FxDirector 経由でも、戦場ストップが許されていなければ戦場の倍率は常に 1', () => {
    const fx = new FxDirector('full');
    fx.allowBattleStop = false;
    for (const id of Object.keys(FX_CUES) as FxCueId[]) fx.emit(id, { tier: 3 });
    for (let i = 0; i < 120; i++) {
      expect(fx.battleScale()).toBe(1);
      fx.update(1 / 60);
    }
    fx.reset();
    fx.allowBattleStop = true;
    fx.emit('finish', { tier: 3 });
    expect(fx.battleScale()).toBe(0);
  });

  it('ヒットストップは重なっても上限まで、明けた直後は受け付けない', () => {
    const t = new TimeFx();
    t.hitStop(0.05);
    t.hitStop(10);
    t.update(FX_HITSTOP_MAX - 0.001);
    expect(t.frozen).toBe(true);
    t.update(0.002);
    expect(t.frozen).toBe(false);
    t.hitStop(0.05);
    expect(t.frozen).toBe(false);
    t.update(FX_HITSTOP_MIN_GAP + 0.01);
    t.hitStop(0.05);
    expect(t.frozen).toBe(true);
  });

  it('描画ストップで止めたぶんの演出の時間は、明けたあとに取り戻す', () => {
    const t = new TimeFx();
    t.hitStop(0.1);
    let total = 0;
    for (let i = 0; i < 60; i++) {
      total += t.fxDt(1 / 60);
      t.update(1 / 60);
    }
    expect(total).toBeCloseTo(1, 5);
  });

  it('スローは指定の秒数だけ戦場（1 人用）と演出をゆっくりにする', () => {
    const t = new TimeFx();
    t.slow(0.5, 0.4);
    expect(t.battleScale(true)).toBeCloseTo(0.4);
    expect(t.fxDt(0.1)).toBeCloseTo(0.04);
    t.update(0.6);
    expect(t.battleScale(true)).toBe(1);
  });
});

describe('BannerQueue: 優先度つきの告知', () => {
  it('重要な告知は割り込み、軽い告知は順番に流れる', () => {
    const q = new BannerQueue();
    const shown: string[] = [];
    q.onChange = (item) => shown.push(item ? item.text : '-');
    expect(q.push({ text: 'WAVE 1', tier: 0 })).toBe('shown');
    expect(q.push({ text: '反撃', tier: 1 })).toBe('queued');
    expect(q.push({ text: 'ヌシ出現', tier: 2 })).toBe('interrupted');
    expect(q.current?.text).toBe('ヌシ出現');
    q.update(FX_BANNER_DURATION[2] + 0.01);
    expect(q.current?.text).toBe('反撃');
    q.update(10);
    expect(q.current).toBeNull();
    expect(shown).toEqual(['WAVE 1', 'ヌシ出現', '反撃', '-']);
  });

  it('同じ告知の連続は 1 つにまとめて回数を数える', () => {
    const q = new BannerQueue();
    q.push({ text: '宝箱', tier: 1 });
    expect(q.push({ text: '宝箱', tier: 1 })).toBe('merged');
    expect(q.current?.count).toBe(2);
    q.push({ text: 'A', tier: 1 });
    q.push({ text: 'B', tier: 1 });
    expect(q.push({ text: 'A', tier: 1 })).toBe('merged');
    expect(q.queued.map((w) => `${w.text}${w.count}`)).toEqual(['A2', 'B1']);
  });

  it('待ちが多すぎたら、いちばん軽いものから捨てる', () => {
    const q = new BannerQueue();
    q.push({ text: 'now', tier: 3 });
    for (let i = 0; i < 4; i++) q.push({ text: `light${i}`, tier: 0 });
    expect(q.push({ text: 'mid', tier: 1 })).toBe('queued');
    expect(q.queued[0].text).toBe('mid');
    expect(q.queued.some((w) => w.text === 'light3')).toBe(false);
  });

  it('待ちがあると軽い告知は短く切り上げる', () => {
    const q = new BannerQueue();
    q.push({ text: 'a', tier: 0 });
    q.push({ text: 'b', tier: 0 });
    q.update(FX_BANNER_DURATION[0] * 0.65);
    expect(q.current?.text).toBe('b');
  });
});

describe('UI 部品の計算', () => {
  it('NumberTween はなめらかに追従し、最後はぴったり止まる', () => {
    const n = new NumberTween(0, 0.08);
    expect(n.set(1000)).toBe(1000);
    n.update(0.08);
    expect(n.shown).toBeCloseTo(500, 0);
    for (let i = 0; i < 60; i++) n.update(1 / 60);
    expect(n.shown).toBe(1000);
    expect(n.settled).toBe(true);
  });

  it('LagGauge は減ったぶんを残し、少し待ってから縮める。回復はすぐ', () => {
    const g = new LagGauge(1);
    expect(g.set(0.6)).toBeCloseTo(0.4);
    expect(g.value).toBeCloseTo(0.6);
    expect(g.lag).toBe(1);
    g.update(LAG_BAR_HOLD * 0.9);
    expect(g.lag).toBe(1);
    for (let i = 0; i < 200; i++) g.update(1 / 60);
    expect(g.lag).toBeCloseTo(0.6);
    expect(g.set(0.9)).toBe(0);
    expect(g.lag).toBeCloseTo(0.9);
  });

  it('FrameProbe は平均・95 パーセンタイル・最大を出す', () => {
    const p = new FrameProbe();
    for (let i = 1; i <= 100; i++) p.record(i);
    const st = p.stats();
    expect(st.avg).toBeCloseTo(50.5);
    expect(st.p95).toBe(96);
    expect(st.max).toBe(100);
  });
});
