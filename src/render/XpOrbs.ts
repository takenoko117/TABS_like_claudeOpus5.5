import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  InstancedMesh,
  MeshBasicMaterial,
  Object3D,
  type PerspectiveCamera,
  type Scene,
  Vector3,
} from 'three';

/** 同時に飛んでいられるオーブの数（超えたぶんの経験値はオーブを出さずにすぐ入る） */
const MAX_ORBS = 120;
/** 1体ぶんのオーブの数の上限と、オーブ1個あたりの経験値の目安 */
const MAX_PER_KILL = 4;
const XP_PER_ORB = 6;
/** 跳ね上がる時間・宙に止まる時間・バーへ飛ぶ時間（秒） */
const POP_TIME = 0.45;
const HOLD_TIME = 0.12;
const FLY_TIME = 0.55;
const GRAVITY = -16;
/** 戦場でのオーブの大きさ（ワールド単位）と、バーに着く直前の画面上の大きさ（px） */
const FIELD_SIZE = 0.42;
const END_SIZE_PX = 12;
/** バーへ向かうとき、カメラからこの距離の点を目指す（画面上ではバーに重なる） */
const TARGET_DISTANCE = 3;

const CORE_COLOR = new Color(0x9dff6a);
const GLOW_COLOR = new Color(0x3fd46b);

interface Orb {
  amount: number;
  age: number;
  origin: Vector3;
  vel: Vector3;
  pos: Vector3;
  /** バーへ飛び始めた位置（飛ぶ前は null） */
  flyFrom: Vector3 | null;
  delay: number;
  spin: number;
}

const _dummy = new Object3D();
const _target = new Vector3();
const _dir = new Vector3();

/**
 * 敵を倒すと出る経験値オーブ（ボクセル）。
 * 倒した場所から跳ね上がり、少し止まってから画面左上の経験値バーへ吸い込まれる。
 * 実際の経験値は倒した瞬間に入っている。HUD は「飛んでいる途中の経験値」を差し引いてバーを描く。
 */
export class XpOrbs {
  private readonly orbs: Orb[] = [];
  private readonly core: InstancedMesh;
  private readonly glow: InstancedMesh;
  private pendingXp = 0;

  constructor(
    scene: Scene,
    private readonly camera: PerspectiveCamera,
    /** 経験値バーの画面上の位置（client 座標）。見えていなければ null */
    private readonly getTarget: () => { x: number; y: number } | null,
    private readonly onAbsorb: (amount: number) => void,
  ) {
    const coreMat = new MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false, transparent: true });
    const glowMat = new MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.35,
      blending: AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.core = new InstancedMesh(new BoxGeometry(1, 1, 1), coreMat, MAX_ORBS);
    this.glow = new InstancedMesh(new BoxGeometry(1.7, 1.7, 1.7), glowMat, MAX_ORBS);
    for (let i = 0; i < MAX_ORBS; i++) {
      this.core.setColorAt(i, CORE_COLOR);
      this.glow.setColorAt(i, GLOW_COLOR);
    }
    for (const m of [this.core, this.glow]) {
      m.count = 0;
      m.frustumCulled = false;
      m.renderOrder = 50;
      scene.add(m);
    }
  }

  /** 飛んでいる途中の経験値の合計 */
  get pending(): number {
    return this.pendingXp;
  }

  /** 倒した敵の位置からオーブを出す。出せなかった経験値はそのまま入ったことにする */
  spawn(pos: Vector3, amount: number): void {
    if (amount <= 0) return;
    const n = Math.min(MAX_PER_KILL, Math.max(1, Math.round(amount / XP_PER_ORB)), MAX_ORBS - this.orbs.length);
    if (n <= 0) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1.2 + Math.random() * 1.6;
      const origin = new Vector3(pos.x, Math.max(0.4, pos.y + 0.3), pos.z);
      this.orbs.push({
        amount: amount / n,
        age: 0,
        origin,
        vel: new Vector3(Math.cos(a) * sp, 5 + Math.random() * 2, Math.sin(a) * sp),
        pos: origin.clone(),
        flyFrom: null,
        delay: i * 0.06,
        spin: Math.random() * Math.PI,
      });
    }
    this.pendingXp += amount;
  }

  update(realDt: number): void {
    if (this.orbs.length === 0) return;
    const dt = Math.min(0.1, realDt);
    const screen = this.getTarget();
    // バーの位置を、カメラから一定距離の 3D の点に直す
    if (screen) {
      const ndcX = (screen.x / window.innerWidth) * 2 - 1;
      const ndcY = -(screen.y / window.innerHeight) * 2 + 1;
      _dir.set(ndcX, ndcY, 0.5).unproject(this.camera).sub(this.camera.position).normalize();
      _target.copy(this.camera.position).addScaledVector(_dir, TARGET_DISTANCE);
    }
    const viewH = 2 * TARGET_DISTANCE * Math.tan((this.camera.fov * Math.PI) / 360);
    const endSize = (END_SIZE_PX / Math.max(1, window.innerHeight)) * viewH;

    let w = 0;
    for (const o of this.orbs) {
      o.age += dt;
      o.spin += dt * 6;
      const t = o.age;
      let size = FIELD_SIZE;
      let done = false;
      if (t < POP_TIME) {
        // 跳ね上がる
        o.pos.copy(o.origin).addScaledVector(o.vel, t);
        o.pos.y = Math.max(0.35, o.origin.y + o.vel.y * t + 0.5 * GRAVITY * t * t);
        size = FIELD_SIZE * Math.min(1, 0.3 + t / 0.12);
      } else if (t < POP_TIME + HOLD_TIME + o.delay || !screen) {
        // 宙に浮いて待つ（バーが見えないときもここで待ち、しばらくしたら入れる）
        o.pos.y += Math.sin(t * 10) * dt * 0.4;
        if (!screen && t > 2) done = true;
      } else {
        o.flyFrom ??= o.pos.clone();
        const p = Math.min(1, (t - POP_TIME - HOLD_TIME - o.delay) / FLY_TIME);
        const e = p * p;
        o.pos.lerpVectors(o.flyFrom, _target, e);
        o.pos.y += Math.sin(p * Math.PI) * 1.2 * (1 - p);
        size = FIELD_SIZE + (endSize - FIELD_SIZE) * e;
        if (p >= 1) done = true;
      }
      if (done) {
        this.pendingXp = Math.max(0, this.pendingXp - o.amount);
        this.onAbsorb(o.amount);
        continue;
      }
      _dummy.position.copy(o.pos);
      _dummy.rotation.set(o.spin * 0.7, o.spin, Math.PI / 4);
      _dummy.scale.setScalar(size);
      _dummy.updateMatrix();
      this.core.setMatrixAt(w, _dummy.matrix);
      this.glow.setMatrixAt(w, _dummy.matrix);
      this.orbs[w++] = o;
    }
    this.orbs.length = w;
    if (this.orbs.length === 0) this.pendingXp = 0;
    this.core.count = w;
    this.glow.count = w;
    this.core.instanceMatrix.needsUpdate = true;
    this.glow.instanceMatrix.needsUpdate = true;
  }

  /** すべて消す（入っていない経験値も入ったことにする） */
  clear(): void {
    this.orbs.length = 0;
    this.pendingXp = 0;
    this.core.count = 0;
    this.glow.count = 0;
  }
}
