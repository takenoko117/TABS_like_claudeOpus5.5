/**
 * かぶくんの「ぷにぷに」と「よちよち歩き」と表情の動き（Three.js 非依存。tests/tag.test.ts から検証する）。
 * 描画側（KabukunGltf）は毎フレーム update を呼び、出てきた値を体の伸び縮み・傾き・アニメの速さ・モーフに当てるだけ。
 */

/** ばねの硬さ（大きいほど速く戻る） */
export const PUNI_STIFFNESS = 210;
/** ばねの減衰（小さいほどぷるぷる揺れが残る） */
export const PUNI_DAMPING = 9;
/** 伸び縮みの上限 */
export const PUNI_MAX = 0.35;
/** よちよち歩きの左右の傾き（ラジアン） */
export const WADDLE_ROLL = 0.16;
/** 一歩ごとのつぶれ */
export const STEP_SQUASH = 0.07;
/** 立っているときの呼吸の伸び縮み */
export const BREATH_AMOUNT = 0.035;
/** 呼吸の速さ（1 秒あたりのラジアン。2π で 1 呼吸） */
export const BREATH_SPEED = 2.6;
/** パンチの振りかぶり・打ち込み・戻りの時間（秒） */
export const PUNCH_WIND = 0.12;
export const PUNCH_STRIKE = 0.08;
export const PUNCH_RECOVER = 0.24;
/** ふっとんでいるときの回転の速さ（ラジアン/秒） */
export const TUMBLE_SPEED = 13;

export interface KabukunMotionInput {
  /** 横方向の速さ（m/s） */
  speed: number;
  /** 宙にいるか */
  air: boolean;
  /** 縦の速さ（着地の強さに使う） */
  vy: number;
  alive: boolean;
  /** ハヤトに狙われている */
  alarmed: boolean;
  /** 勝った（よろこぶ） */
  won: boolean;
  /** パンチ・爆風で動けない（くらくら） */
  stunned?: boolean;
  /** ふっとんでいる（ぐるぐる回る） */
  flung?: boolean;
}

/** 当てる値 */
export interface KabukunPose {
  /** 縦の伸び（+ で伸びる、- でつぶれる）。横は体積を保つように縮む */
  stretch: number;
  /** 左右の傾き */
  roll: number;
  /** 前のめり */
  lean: number;
  /** 弾む高さ */
  bob: number;
  /** ふっとびの前転（ラジアン。体の真ん中を軸に回す） */
  spin: number;
  /** 体のひねり（ラジアン。パンチで振りかぶると右へ、打つと左へ） */
  twist: number;
  /** 右腕の向き（-1 = 後ろへ振りかぶる、0 = いつもの腕、+1 = 前へ突き出す） */
  punchArm: number;
  /** 歩きのアニメの重み（0〜1）と速さ */
  walkWeight: number;
  walkSpeed: number;
  /** 目のモーフ（名前 → 0〜1） */
  eyes: Record<string, number>;
  /** 口のモーフ */
  mouth: Record<string, number>;
}

export class KabukunMotion {
  /** ばねの位置と速さ */
  private s = 0;
  private v = 0;
  private wasAir = false;
  private lastVy = 0;
  /** 歩きの位相（ラジアン。2π で 2 歩） */
  phase = 0;
  private lastStep = 0;
  private walkW = 0;
  private blinkTimer = 2;
  private blink = 0;
  /** 当たったときの顔の残り秒 */
  private ouch = 0;
  /** パンチを打ち始めてからの秒（負ならパンチしていない） */
  private punchT = -1;
  private dizzy = 0;
  /** 呼吸の位相 */
  private breath = 0;
  private spin = 0;
  private readonly pose: KabukunPose = { stretch: 0, roll: 0, lean: 0, bob: 0, spin: 0, twist: 0, punchArm: 0, walkWeight: 0, walkSpeed: 1, eyes: {}, mouth: {} };

  constructor(private readonly random: () => number = Math.random) {}

  /** 外から力を加える（+ で伸びる、- でつぶれる） */
  poke(amount: number): void {
    this.v += amount * 14;
  }

  /** 当たった */
  hit(): void {
    this.poke(-0.35);
    this.ouch = 0.9;
  }

  /** パンチを打つ（振りかぶって、右腕を体ごと前へ突き出す） */
  punch(): void {
    // 打っている最中に同じパンチの知らせが遅れて届いても、やり直さない
    if (this.punchT >= 0 && this.punchT < PUNCH_WIND + PUNCH_STRIKE + PUNCH_RECOVER) return;
    this.punchT = 0;
    this.poke(-0.12);
  }

  update(dt: number, inp: KabukunMotionInput): KabukunPose {
    // 跳んだ・着地した
    if (inp.air && !this.wasAir) this.poke(0.22);
    if (!inp.air && this.wasAir) this.poke(-Math.min(0.4, 0.1 + Math.abs(this.lastVy) * 0.03));
    this.wasAir = inp.air;
    this.lastVy = inp.vy;

    // 歩き: 速さに合わせて位相を進め、一歩ごとに少しつぶれる
    const moving = inp.alive && !inp.air && inp.speed > 0.4;
    this.walkW += ((moving ? 1 : 0) - this.walkW) * Math.min(1, dt * 10);
    if (moving) {
      this.phase += dt * (5 + inp.speed * 1.5);
      const step = Math.floor(this.phase / Math.PI);
      if (step !== this.lastStep) {
        this.lastStep = step;
        this.poke(-STEP_SQUASH);
      }
    }

    // ばね（ぷにぷに）
    const a = -PUNI_STIFFNESS * this.s - PUNI_DAMPING * this.v;
    this.v += a * dt;
    this.s += this.v * dt;
    if (this.s > PUNI_MAX) {
      this.s = PUNI_MAX;
      this.v = Math.min(0, this.v);
    } else if (this.s < -PUNI_MAX) {
      this.s = -PUNI_MAX;
      this.v = Math.max(0, this.v);
    }

    const p = this.pose;
    // 立っているときは呼吸で、ゆっくりふくらんだりしぼんだりする（体も少しゆれる）
    const still = inp.alive && !inp.air ? 1 - this.walkW : 0;
    this.breath += dt * BREATH_SPEED;
    const breath = Math.sin(this.breath);
    p.stretch = this.s + breath * BREATH_AMOUNT * still;
    // よちよち: 一歩ごとに左右へ体を傾ける
    p.roll = Math.sin(this.phase) * WADDLE_ROLL * this.walkW + Math.sin(this.breath * 0.5) * 0.025 * still;
    p.lean = Math.min(0.25, inp.speed * 0.025) * this.walkW;
    // パンチ: 振りかぶる → 打ち込む → 戻る
    p.twist = 0;
    p.punchArm = 0;
    if (this.punchT >= 0) {
      const before = this.punchT;
      this.punchT += dt;
      const t = this.punchT;
      let arm = 0;
      let lean = 0;
      let twist = 0;
      if (t < PUNCH_WIND) {
        const k = t / PUNCH_WIND;
        arm = -0.8 * k;
        lean = -0.25 * k;
        twist = -0.4 * k;
      } else if (t < PUNCH_WIND + PUNCH_STRIKE) {
        // 打ち込んだ瞬間に体がびよんと伸びる
        if (before < PUNCH_WIND) this.poke(0.3);
        const k = (t - PUNCH_WIND) / PUNCH_STRIKE;
        arm = -0.8 + 1.8 * k;
        lean = -0.25 + 0.85 * k;
        twist = -0.4 + 0.8 * k;
      } else if (t < PUNCH_WIND + PUNCH_STRIKE + PUNCH_RECOVER) {
        if (before < PUNCH_WIND) this.poke(0.3);
        const k = (t - PUNCH_WIND - PUNCH_STRIKE) / PUNCH_RECOVER;
        // 突き出したまま少し止めてから戻す
        const e = k < 0.3 ? 1 : 1 - (k - 0.3) / 0.7;
        arm = e;
        lean = 0.6 * e;
        twist = 0.4 * e;
      } else {
        this.punchT = -1;
      }
      p.punchArm = arm;
      p.lean += lean;
      p.twist = twist;
    }
    // くらくら: 体がぐるぐる揺れる
    if (inp.stunned && inp.alive) {
      this.dizzy += dt * 7;
      p.roll += Math.sin(this.dizzy) * 0.22;
      p.lean += Math.cos(this.dizzy) * 0.12;
    }
    p.bob = Math.abs(Math.sin(this.phase)) * 0.05 * this.walkW;
    // ふっとび: 前へぐるぐる回り、終わったら近いほうの一回転へ戻す
    if (inp.flung && inp.alive) {
      this.spin += dt * TUMBLE_SPEED;
    } else if (this.spin !== 0) {
      const target = Math.round(this.spin / (Math.PI * 2)) * Math.PI * 2;
      this.spin += (target - this.spin) * Math.min(1, dt * 10);
      if (Math.abs(target - this.spin) < 0.01) this.spin = 0;
    }
    p.spin = this.spin;
    p.walkWeight = this.walkW;
    p.walkSpeed = 0.7 + inp.speed * 0.22;

    // 表情
    this.ouch = Math.max(0, this.ouch - dt);
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.blink = 0.14;
      this.blinkTimer = 1.8 + this.random() * 3;
    }
    this.blink = Math.max(0, this.blink - dt);
    const eyes: Record<string, number> = {};
    const mouth: Record<string, number> = {};
    if (!inp.alive) {
      eyes.sad = 1;
      eyes.half = 0.6;
      mouth.frown = 1;
    } else if (inp.won) {
      eyes.happy = 1;
      mouth.smile_open = 1;
    } else if (inp.flung) {
      eyes.surprised = 1;
      mouth.wide = 1;
    } else if (inp.stunned) {
      eyes.half = 1;
      eyes[Math.sin(this.dizzy) > 0 ? 'look_left' : 'look_right'] = 1;
      mouth.wide = 0.6;
    } else if (this.ouch > 0) {
      eyes.surprised = 1;
      mouth.wide = 1;
    } else if (inp.alarmed) {
      eyes.surprised = 1;
      mouth.small = 1;
    } else {
      if (this.blink > 0) eyes.blink = 1;
      // 走るとはふはふ口が開く
      if (inp.speed > 6.5) mouth.open = 0.5 + 0.5 * Math.abs(Math.sin(this.phase * 2));
    }
    p.eyes = eyes;
    p.mouth = mouth;
    return p;
  }
}
