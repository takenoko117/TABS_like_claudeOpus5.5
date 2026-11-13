import { Vector3 } from 'three';
import { DistanceConstraint } from './Constraint';
import { PF_NO_COLLIDE, PF_RECORD_CONTACT, Particle } from './Particle';
import { SpatialHash } from './SpatialHash';

/** 粒子同士の接触情報（PF_RECORD_CONTACT を持つ粒子が関わる場合のみ記録） */
export interface Contact {
  a: Particle;
  b: Particle;
  /** 接触点（2 粒子の中間点） */
  point: Vector3;
  /** a から b へ向かう単位ベクトル */
  normal: Vector3;
  /** 相対速度 (a の速度 - b の速度) */
  relVel: Vector3;
  /** 相対速度の大きさ */
  relSpeed: number;
}

/** 戦場に配置される円柱状の障害物（石柱・バリケード等） */
export interface ObstacleCylinder {
  x: number;
  z: number;
  radius: number;
  height: number;
  color?: number;
}

/** 断崖・一本橋ステージ用の奈落（落下エリア）定義 */
export interface ChasmSpec {
  minX: number;
  maxX: number;
  bridgeHalfWidth: number;
  /** 橋のZ中心座標リスト（省略時は [0] = 中央1本橋） */
  bridgeCentersZ?: readonly number[];
}

/** 戦場の奈落ホール（すり鉢・中央クレーター・落とし穴ブロック等の円形落下穴）定義 */
export interface PitSpec {
  x: number;
  z: number;
  radius: number;
  /** プレイヤー/サンドボックス設置の落とし穴トラップかどうか（trueの場合、ユニットAIが回避せず落下する） */
  isTrap?: boolean;
}

/** 戦場のスロープ（坂道ブロック）定義 */
export interface SlopeSpec {
  x: number;
  z: number;
  width: number;
  length: number;
  height: number;
  facing: number;
  forwardX: number;
  forwardZ: number;
  rightX: number;
  rightZ: number;
}

/** 箱型の障害物（壊せる地物の区画）。active を false にすると当たらなくなる */
export interface ObstacleBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  active: boolean;
}

/** 粒子が箱に当たった記録（壊せる地物へのダメージに使う） */
export interface BoxImpact {
  /** boxes の添字 */
  box: number;
  particle: Particle;
  /** めり込む直前の速さ（m/s） */
  speed: number;
}

/** 箱の検索グリッドの範囲と1マスの大きさ */
const BOX_GRID_MIN_X = -27;
const BOX_GRID_MIN_Z = -21;
const BOX_GRID_COLS = 54;
const BOX_GRID_ROWS = 42;

/** 戦場を囲む見えない壁（原点中心の矩形。高さは無限） */
export interface FieldWalls {
  maxX: number;
  maxZ: number;
}

/** 通常の戦場の壁。配置枠（±22 / ±16）の少し外側に置く */
export const BATTLE_FIELD_WALLS: Readonly<FieldWalls> = { maxX: 25, maxZ: 19 };

/** 壁の反発係数 */
const WALL_RESTITUTION = 0.5;
/** これ未満の速さでの接触は跳ね返さない（歩いて触れただけのユニットを弾かない） */
const WALL_MIN_IMPACT_SPEED = 2.5;
/** 跳ね返り速度の下限（弱い衝突でも壁に張り付かないように） */
const WALL_MIN_BOUNCE_SPEED = 1.5;
/** 跳ね返り速度の上限（強烈なノックバックでも反対側まで飛ばないように） */
const WALL_MAX_BOUNCE_SPEED = 10;

const EMPTY_LIST: readonly number[] = [];

/** 空間ハッシュのマス目の初期の大きさ */
const PHYSICS_HASH_SPACING = 0.5;
/** 空間ハッシュの初期の容量（粒子数） */
const PHYSICS_HASH_CAPACITY = 1024;
/** maxRadius の初期値 */
const PHYSICS_MIN_MAX_RADIUS = 0.1;
/**
 * 拘束の反復回数（全端末一律。端末の画質設定に連動させるとオンライン対戦がずれる）。
 * 8→4 にしても関節のばねの見た目はほぼ変わらず、物理の 3 割強を占める反復計算が半分になる
 */
export const PHYSICS_ITERATIONS = 4;
/**
 * 粒子同士の衝突（体どうしの押し合い）を解く間隔（ステップ数。全端末一律）。
 * 武器など接触を記録する粒子（PF_RECORD_CONTACT）は当たり判定のため毎ステップ解く
 */
export const PHYSICS_COLLISION_INTERVAL = 2;
/**
 * これより半径が大きい粒子（巨人・ドラゴンなど）は「大きい粒子」として別に扱う。
 * 近傍探索の範囲が全体の最大半径に引っ張られ、全員分の探索が重くなるのを防ぐ
 */
export const PHYSICS_LARGE_RADIUS = 0.3;

const _va = new Vector3();
const _vb = new Vector3();

/**
 * 自前の物理エンジン本体。
 * - Verlet 積分（位置ベース）
 * - 距離拘束の反復解法（Gauss-Seidel）
 * - 地面（y = groundY の無限平面およびスロープ・落とし穴）との衝突と摩擦
 * - 空間ハッシュを用いた球同士の衝突（異なるボディ間のみ）
 */
export class PhysicsWorld {
  readonly particles: Particle[] = [];
  readonly constraints: DistanceConstraint[] = [];
  readonly gravity = new Vector3(0, -9.81, 0);
  /** 拘束の反復回数 */
  iterations = PHYSICS_ITERATIONS;
  /** 空気抵抗的な速度減衰（1 ステップあたりの残存率） */
  damping = 0.998;
  groundY = 0;
  /** 1 秒あたりの最大移動速度（数値爆発の防止） */
  maxSpeed = 60;
  collisionsEnabled = true;
  /** 粒子同士の衝突を解く間隔（ステップ数）。1 で毎ステップ */
  collisionInterval = PHYSICS_COLLISION_INTERVAL;
  /** 直近の step() で記録された接触 */
  readonly contacts: Contact[] = [];
  /** 戦場の障害物リスト */
  obstacles: ObstacleCylinder[] = [];
  /** 断崖・橋ステージの奈落設定（null なら全面が地面） */
  chasm: ChasmSpec | null = null;
  /** 円形奈落ホール（すり鉢クレーター・落とし穴等）のリスト */
  pits: PitSpec[] = [];
  /** スロープ（坂道ブロック）のリスト */
  slopes: SlopeSpec[] = [];
  /** 箱型の障害物（壊せる地物）。変更したら markBoxesDirty() を呼ぶ */
  boxes: ObstacleBox[] = [];
  /** 直近の step() で記録された、粒子と箱の接触 */
  readonly boxImpacts: BoxImpact[] = [];
  private boxGrid: number[][] = [];
  private boxGridDirty = true;
  private readonly boxImpactKeys = new Set<number>();
  /** 戦場外周（|x|>arenaMaxX または |z|>arenaMaxZ）を奈落とする浮島アリーナ設定 */
  arenaBounds: { maxX: number; maxZ: number } | null = null;

  /** 戦場を囲む見えない壁（null なら壁なし） */
  fieldWalls: Readonly<FieldWalls> | null;

  constructor(fieldWalls: Readonly<FieldWalls> | null = null) {
    this.fieldWalls = fieldWalls;
  }

  private readonly contactPool: Contact[] = [];
  /**
   * 近傍探索の空間ハッシュ。表の大きさは粒子数に合わせて増えるだけなので、clear() で作り直す
   * （前の戦闘の大きさが残ると、近傍の列挙順が端末ごとに変わり、オンライン対戦の同期がずれる）
   */
  private hash = new SpatialHash(PHYSICS_HASH_SPACING, PHYSICS_HASH_CAPACITY);
  /** いちばん大きい粒子の半径（近傍探索の範囲）。増えるだけなので clear() で戻す */
  private maxRadius = PHYSICS_MIN_MAX_RADIUS;
  private nextBodyId = 1;
  /** clear() からのステップ数（衝突を解くステップの判定に使う。戦闘ごとに 0 へ戻す） */
  private stepCount = 0;
  /** 衝突判定の作業用リスト（毎ステップ詰め直す） */
  private readonly smallList: Particle[] = [];
  private readonly largeList: Particle[] = [];

  /** 新しいボディ ID を払い出す */
  createBodyId(): number {
    return this.nextBodyId++;
  }

  addParticle(p: Particle): Particle {
    this.particles.push(p);
    if (p.radius > this.maxRadius) this.maxRadius = p.radius;
    return p;
  }

  addConstraint(c: DistanceConstraint): DistanceConstraint {
    this.constraints.push(c);
    return c;
  }

  /** 指定ボディに属する粒子と、それに関わる拘束をすべて削除する */
  removeBody(bodyId: number): void {
    let w = 0;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (p.bodyId !== bodyId) this.particles[w++] = p;
    }
    this.particles.length = w;
    w = 0;
    for (let i = 0; i < this.constraints.length; i++) {
      const c = this.constraints[i];
      if (c.a.bodyId !== bodyId && c.b.bodyId !== bodyId) this.constraints[w++] = c;
    }
    this.constraints.length = w;
  }

  /** 箱の位置や active を変えたあとに呼ぶ（検索グリッドを作り直す） */
  markBoxesDirty(): void {
    this.boxGridDirty = true;
  }

  /**
   * 粒子・拘束を消し、戦闘をまたいで残ると結果が変わる状態も初期値に戻す。
   * 同じ操作から同じ結果になるよう（オンライン対戦のロックステップ）、戦闘の前の履歴に左右されないようにする
   */
  clear(): void {
    this.boxImpacts.length = 0;
    this.particles.length = 0;
    this.constraints.length = 0;
    this.contacts.length = 0;
    this.maxRadius = PHYSICS_MIN_MAX_RADIUS;
    this.stepCount = 0;
    this.smallList.length = 0;
    this.largeList.length = 0;
    this.hash = new SpatialHash(PHYSICS_HASH_SPACING, PHYSICS_HASH_CAPACITY);
  }

  /** 物理を dt 秒進める（固定 dt での呼び出しを推奨） */
  step(dt: number): void {
    this.contacts.length = 0;
    this.boxImpacts.length = 0;
    const hasBoxes = this.boxes.length > 0;
    if (hasBoxes && this.boxGridDirty) this.rebuildBoxGrid();
    this.integrate(dt);
    this.solveFieldWalls(dt);
    for (let it = 0; it < this.iterations; it++) {
      const cs = this.constraints;
      for (let i = 0; i < cs.length; i++) cs[i].solve();
      this.solveGround(false);
      if (this.obstacles.length > 0) this.solveObstacles();
      // 箱は重いので1回おきに解く（最後にもう一度、接触を記録しながら解く）
      if (hasBoxes && (it & 1) === 1) this.solveBoxes(false, dt);
      this.solveFieldWalls(dt);
    }
    if (this.collisionsEnabled) {
      const interval = Math.max(1, this.collisionInterval | 0);
      // 間引くステップでは、接触を記録する粒子（武器など）が関わる組だけ解く
      this.solveParticleCollisions(dt, this.stepCount % interval !== 0);
    }
    this.stepCount++;
    if (this.obstacles.length > 0) this.solveObstacles();
    if (hasBoxes) this.solveBoxes(true, dt);
    this.solveFieldWalls(dt);
    // 最後に摩擦付きで地面判定を行う
    this.solveGround(true);
  }

  private integrate(dt: number): void {
    const dt2 = dt * dt;
    const g = this.gravity;
    const damp = this.damping;
    const maxDisp = this.maxSpeed * dt;
    for (const p of this.particles) {
      p.grounded = false;
      if (p.invMass === 0) {
        p.force.set(0, 0, 0);
        continue;
      }
      let vx = (p.pos.x - p.prev.x) * damp;
      let vy = (p.pos.y - p.prev.y) * damp;
      let vz = (p.pos.z - p.prev.z) * damp;
      // 速度上限
      const d2 = vx * vx + vy * vy + vz * vz;
      if (d2 > maxDisp * maxDisp) {
        const s = maxDisp / Math.sqrt(d2);
        vx *= s;
        vy *= s;
        vz *= s;
      }
      const ax = g.x + p.force.x * p.invMass;
      const ay = g.y + p.force.y * p.invMass;
      const az = g.z + p.force.z * p.invMass;
      // 数値異常（NaN）が出た粒子はその場で停止させる
      if (!Number.isFinite(vx + vy + vz + ax + ay + az)) {
        p.prev.copy(p.pos);
        p.force.set(0, 0, 0);
        continue;
      }
      p.prev.copy(p.pos);
      p.pos.x += vx + ax * dt2;
      p.pos.y += vy + ay * dt2;
      p.pos.z += vz + az * dt2;
      p.force.set(0, 0, 0);
    }
  }

  /** 粒子が指定の (x, z) において奈落（穴）の上にあるか判定する */
  isOverChasm(x: number, z: number): boolean {
    if (this.arenaBounds) {
      if (Math.abs(x) > this.arenaBounds.maxX || Math.abs(z) > this.arenaBounds.maxZ) {
        return true;
      }
    }
    for (const pit of this.pits) {
      const dx = x - pit.x;
      const dz = z - pit.z;
      if (dx * dx + dz * dz < pit.radius * pit.radius) {
        return true;
      }
    }
    const c = this.chasm;
    if (!c) return false;
    if (x > c.minX && x < c.maxX) {
      const centers = c.bridgeCentersZ && c.bridgeCentersZ.length > 0 ? c.bridgeCentersZ : [0];
      for (const cz of centers) {
        if (Math.abs(z - cz) <= c.bridgeHalfWidth) {
          return false; // いずれかの橋の上にある
        }
      }
      return true;
    }
    return false;
  }

  /** 指定座標 (x, z) におけるスロープ（坂道）の路面高さを返す（スロープ外は 0） */
  getSlopeHeightAt(x: number, z: number): number {
    let maxH = 0;
    const slopes = this.slopes;
    for (let i = 0; i < slopes.length; i++) {
      const s = slopes[i];
      const dx = x - s.x;
      const dz = z - s.z;
      const localRight = dx * s.rightX + dz * s.rightZ;
      const halfW = s.width * 0.5;
      if (Math.abs(localRight) > halfW) continue;
      const localFwd = dx * s.forwardX + dz * s.forwardZ;
      const halfL = s.length * 0.5;
      if (Math.abs(localFwd) > halfL) continue;

      // 後端 (-halfL) で高さ 0、前端 (+halfL * 0.65) で最大高さ s.height、その先は平坦な天板デッキ
      const rampEnd = halfL * 0.65;
      const t = Math.max(0, Math.min(1, (localFwd + halfL) / (halfL + rampEnd)));
      const h = t * s.height;
      if (h > maxH) maxH = h;
    }
    return maxH;
  }

  /** 指定座標 (x, z) における有効な地面の高さ（奈落・通常地面・スロープを考慮）を返す */
  getGroundHeightAt(x: number, z: number): number {
    if (this.isOverChasm(x, z)) return -20;
    return this.groundY + this.getSlopeHeightAt(x, z);
  }

  private solveGround(applyFriction: boolean): void {
    const gy = this.groundY;
    const chasm = this.chasm;
    for (const p of this.particles) {
      // 奈落エリア上（またはすでに崖下へ落下中）の粒子は地面を y = -20 とする
      const inPit = p.pos.y < gy - 0.18 || this.isOverChasm(p.pos.x, p.pos.z);
      const slopeH = inPit ? 0 : this.getSlopeHeightAt(p.pos.x, p.pos.z);
      const localGroundY = inPit ? -20 : gy + slopeH;
      const minY = localGroundY + p.radius;

      // 崖下に落下した粒子が崖の側面へめり込まないように水平位置を制限
      if (chasm !== null && p.pos.y < gy - 0.05 && p.pos.x > chasm.minX - 0.5 && p.pos.x < chasm.maxX + 0.5) {
        if (p.pos.x < chasm.minX + p.radius) p.pos.x = chasm.minX + p.radius;
        if (p.pos.x > chasm.maxX - p.radius) p.pos.x = chasm.maxX - p.radius;
        const centers = chasm.bridgeCentersZ && chasm.bridgeCentersZ.length > 0 ? chasm.bridgeCentersZ : [0];
        for (const cz of centers) {
          const dz = p.pos.z - cz;
          if (Math.abs(dz) < chasm.bridgeHalfWidth + p.radius) {
            p.pos.z = cz + (dz >= 0 ? 1 : -1) * (chasm.bridgeHalfWidth + p.radius);
          }
        }
      }

      if (p.pos.y < minY) {
        p.pos.y = minY;
      }
      if (applyFriction && p.pos.y <= minY + 1e-3) {
        p.grounded = !inPit;
        // 水平方向の移動量を摩擦係数ぶん減らす
        const f = p.friction;
        p.prev.x += (p.pos.x - p.prev.x) * f;
        p.prev.z += (p.pos.z - p.prev.z) * f;
        // 地面にめり込む向きの速度は打ち消す
        if (p.prev.y > p.pos.y) p.prev.y = p.pos.y;
      }
    }
  }

  /** 見えない壁の外へ出た粒子を内側へ戻し、勢いがあれば跳ね返す */
  private solveFieldWalls(dt: number): void {
    const walls = this.fieldWalls;
    if (!walls) return;
    for (const p of this.particles) {
      if (p.invMass === 0) continue;
      this.bounceOffWall(p, 'x', walls.maxX - p.radius, dt);
      this.bounceOffWall(p, 'z', walls.maxZ - p.radius, dt);
    }
  }

  private bounceOffWall(p: Particle, axis: 'x' | 'z', limit: number, dt: number): void {
    const coord = p.pos[axis];
    if (Math.abs(coord) <= limit) return;
    const side = coord > 0 ? 1 : -1;
    const wall = side * limit;
    // Verlet の暗黙速度のうち、壁へ向かう成分
    const impact = (side * (coord - p.prev[axis])) / dt;
    p.pos[axis] = wall;
    if (impact <= 0) return;
    const bounce =
      impact < WALL_MIN_IMPACT_SPEED
        ? 0
        : Math.min(WALL_MAX_BOUNCE_SPEED, Math.max(WALL_MIN_BOUNCE_SPEED, impact * WALL_RESTITUTION));
    p.prev[axis] = wall + side * bounce * dt;
  }

  /** 円柱障害物（石柱など）との押し出し判定 */
  private solveObstacles(): void {
    const obsList = this.obstacles;
    for (let o = 0; o < obsList.length; o++) {
      const obs = obsList[o];
      for (const p of this.particles) {
        if (p.invMass === 0) continue;
        if (p.pos.y - p.radius >= obs.height || p.pos.y + p.radius <= 0) continue;
        const dx = p.pos.x - obs.x;
        const dz = p.pos.z - obs.z;
        const minR = obs.radius + p.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 < minR * minR) {
          const d = Math.sqrt(d2) || 1e-4;
          const nx = dx / d;
          const nz = dz / d;
          p.pos.x = obs.x + nx * minR;
          p.pos.z = obs.z + nz * minR;
        }
      }
    }
  }

  private rebuildBoxGrid(): void {
    this.boxGridDirty = false;
    const grid: number[][] = Array.from({ length: BOX_GRID_COLS * BOX_GRID_ROWS }, () => []);
    // 巨体の粒子は大きいので、後から追加されても届くよう余裕を持たせる
    const pad = Math.max(1.2, this.maxRadius);
    this.boxes.forEach((b, idx) => {
      if (!b.active) return;
      const i0 = Math.max(0, Math.floor(b.minX - pad - BOX_GRID_MIN_X));
      const i1 = Math.min(BOX_GRID_COLS - 1, Math.floor(b.maxX + pad - BOX_GRID_MIN_X));
      const j0 = Math.max(0, Math.floor(b.minZ - pad - BOX_GRID_MIN_Z));
      const j1 = Math.min(BOX_GRID_ROWS - 1, Math.floor(b.maxZ + pad - BOX_GRID_MIN_Z));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) grid[j * BOX_GRID_COLS + i].push(idx);
    });
    this.boxGrid = grid;
  }

  /** (x, z) の近くにある箱の添字（なければ空配列） */
  boxesNear(x: number, z: number): readonly number[] {
    if (this.boxGridDirty) this.rebuildBoxGrid();
    const i = Math.floor(x - BOX_GRID_MIN_X);
    const j = Math.floor(z - BOX_GRID_MIN_Z);
    if (i < 0 || j < 0 || i >= BOX_GRID_COLS || j >= BOX_GRID_ROWS) return EMPTY_LIST;
    return this.boxGrid[j * BOX_GRID_COLS + i] ?? EMPTY_LIST;
  }

  /** 箱型の障害物との押し出し。record なら接触を boxImpacts に記録し、天面に乗った粒子に摩擦をかける */
  private solveBoxes(record: boolean, dt: number): void {
    const boxes = this.boxes;
    if (record) this.boxImpactKeys.clear();
    for (const p of this.particles) {
      if (p.invMass === 0) continue;
      const list = this.boxesNear(p.pos.x, p.pos.z);
      for (let n = 0; n < list.length; n++) {
        const bi = list[n];
        const b = boxes[bi];
        if (!b.active) continue;
        const r = p.radius;
        const px = p.pos.x;
        const py = p.pos.y;
        const pz = p.pos.z;
        if (px < b.minX - r || px > b.maxX + r || pz < b.minZ - r || pz > b.maxZ + r || py < b.minY - r || py > b.maxY + r) continue;
        const qx = px < b.minX ? b.minX : px > b.maxX ? b.maxX : px;
        const qy = py < b.minY ? b.minY : py > b.maxY ? b.maxY : py;
        const qz = pz < b.minZ ? b.minZ : pz > b.maxZ ? b.maxZ : pz;
        let dx = px - qx;
        let dy = py - qy;
        let dz = pz - qz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= r * r) continue;
        let push: number;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2);
          dx /= d;
          dy /= d;
          dz /= d;
          push = r - d;
        } else {
          // 中心が箱の中: いちばん浅い面から押し出す（底面へは押さない）
          const pen = [px - b.minX, b.maxX - px, pz - b.minZ, b.maxZ - pz, b.maxY - py];
          let m = 0;
          for (let k = 1; k < pen.length; k++) if (pen[k] < pen[m]) m = k;
          dx = m === 0 ? -1 : m === 1 ? 1 : 0;
          dz = m === 2 ? -1 : m === 3 ? 1 : 0;
          dy = m === 4 ? 1 : 0;
          push = pen[m] + r;
        }
        if (record) {
          const key = p.bodyId * 4096 + bi;
          if (!this.boxImpactKeys.has(key)) {
            this.boxImpactKeys.add(key);
            const vx = p.pos.x - p.prev.x;
            const vy = p.pos.y - p.prev.y;
            const vz = p.pos.z - p.prev.z;
            // 押し出す向きへの速さ（箱へ向かう成分）
            const into = -(vx * dx + vy * dy + vz * dz) / dt;
            this.boxImpacts.push({ box: bi, particle: p, speed: Math.max(0, into) });
          }
        }
        p.pos.x += dx * push;
        p.pos.y += dy * push;
        p.pos.z += dz * push;
        if (record && dy > 0.7) {
          // 天面に乗った: 地面と同じように摩擦をかけ、接地扱いにする
          p.grounded = true;
          const f = p.friction;
          p.prev.x += (p.pos.x - p.prev.x) * f;
          p.prev.z += (p.pos.z - p.prev.z) * f;
          if (p.prev.y > p.pos.y) p.prev.y = p.pos.y;
        }
      }
    }
  }

  /**
   * 粒子同士の衝突を解く。
   * - 衝突しない粒子（PF_NO_COLLIDE）は空間ハッシュにも入れない
   * - 半径が PHYSICS_LARGE_RADIUS を超える粒子は別リストにし、小さい粒子どうしの探索範囲を小さく保つ
   * - recordOnly のときは、接触を記録する粒子（PF_RECORD_CONTACT）が関わる組だけ解く
   */
  private solveParticleCollisions(dt: number, recordOnly: boolean): void {
    const ps = this.particles;
    if (ps.length < 2) return;
    const small = this.smallList;
    const large = this.largeList;
    small.length = 0;
    large.length = 0;
    let smallMaxR = PHYSICS_MIN_MAX_RADIUS;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (p.flags & PF_NO_COLLIDE) continue;
      if (p.radius > PHYSICS_LARGE_RADIUS) {
        large.push(p);
      } else {
        small.push(p);
        if (p.radius > smallMaxR) smallMaxR = p.radius;
      }
    }
    const hash = this.hash;
    hash.spacing = Math.max(0.25, smallMaxR * 2);
    hash.build(small);
    const ids = hash.queryIds;

    // 小さい粒子どうし
    const ns = small.length;
    for (let i = 0; i < ns; i++) {
      const pi = small[i];
      const iRec = (pi.flags & PF_RECORD_CONTACT) !== 0;
      if (recordOnly && !iRec) continue;
      hash.query(pi.pos, pi.radius + smallMaxR);
      const count = hash.queryCount;
      for (let q = 0; q < count; q++) {
        const j = ids[q];
        if (j === i) continue;
        const pj = small[j];
        if (recordOnly) {
          // 両方が記録対象の組は添字の小さい側で 1 回だけ解く
          if (j < i && pj.flags & PF_RECORD_CONTACT) continue;
        } else if (j < i) {
          continue;
        }
        this.collidePair(pi, pj, dt);
      }
    }

    // 大きい粒子と小さい粒子・大きい粒子どうし
    const nl = large.length;
    for (let i = 0; i < nl; i++) {
      const pi = large[i];
      const iRec = (pi.flags & PF_RECORD_CONTACT) !== 0;
      hash.query(pi.pos, pi.radius + smallMaxR);
      const count = hash.queryCount;
      for (let q = 0; q < count; q++) {
        const pj = small[ids[q]];
        if (recordOnly && !iRec && !(pj.flags & PF_RECORD_CONTACT)) continue;
        this.collidePair(pi, pj, dt);
      }
      for (let j = i + 1; j < nl; j++) {
        const pj = large[j];
        if (recordOnly && !iRec && !(pj.flags & PF_RECORD_CONTACT)) continue;
        this.collidePair(pi, pj, dt);
      }
    }
  }

  /** 2 粒子が重なっていれば押し戻し、必要なら接触を記録する（同じボディ同士は無視） */
  private collidePair(pi: Particle, pj: Particle, dt: number): void {
    if (pi.bodyId >= 0 && pi.bodyId === pj.bodyId) return;
    const dx = pj.pos.x - pi.pos.x;
    const dy = pj.pos.y - pi.pos.y;
    const dz = pj.pos.z - pi.pos.z;
    const rr = pi.radius + pj.radius;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= rr * rr || d2 < 1e-12) return;
    const w = pi.invMass + pj.invMass;
    if (w === 0) return;
    const d = Math.sqrt(d2);
    const nx = dx / d;
    const ny = dy / d;
    const nz = dz / d;
    if ((pi.flags | pj.flags) & PF_RECORD_CONTACT) {
      this.recordContact(pi, pj, nx, ny, nz, dt);
    }
    // めり込みを質量比で押し戻す
    const corr = (rr - d) / w;
    const ci = corr * pi.invMass;
    const cj = corr * pj.invMass;
    pi.pos.x -= nx * ci;
    pi.pos.y -= ny * ci;
    pi.pos.z -= nz * ci;
    pj.pos.x += nx * cj;
    pj.pos.y += ny * cj;
    pj.pos.z += nz * cj;
  }

  private recordContact(a: Particle, b: Particle, nx: number, ny: number, nz: number, dt: number): void {
    const idx = this.contacts.length;
    let c = this.contactPool[idx];
    if (!c) {
      c = { a, b, point: new Vector3(), normal: new Vector3(), relVel: new Vector3(), relSpeed: 0 };
      this.contactPool[idx] = c;
    }
    c.a = a;
    c.b = b;
    c.point.addVectors(a.pos, b.pos).multiplyScalar(0.5);
    c.normal.set(nx, ny, nz);
    a.getVelocity(dt, _va);
    b.getVelocity(dt, _vb);
    c.relVel.subVectors(_va, _vb);
    c.relSpeed = c.relVel.length();
    this.contacts.push(c);
  }
}
