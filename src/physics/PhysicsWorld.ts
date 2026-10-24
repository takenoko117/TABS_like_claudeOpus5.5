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
}

const _va = new Vector3();
const _vb = new Vector3();

/**
 * 自前の物理エンジン本体。
 * - Verlet 積分（位置ベース）
 * - 距離拘束の反復解法（Gauss-Seidel）
 * - 地面（y = groundY の無限平面）との衝突と摩擦
 * - 空間ハッシュを用いた球同士の衝突（異なるボディ間のみ）
 */
export class PhysicsWorld {
  readonly particles: Particle[] = [];
  readonly constraints: DistanceConstraint[] = [];
  readonly gravity = new Vector3(0, -9.81, 0);
  /** 拘束の反復回数 */
  iterations = 8;
  /** 空気抵抗的な速度減衰（1 ステップあたりの残存率） */
  damping = 0.998;
  groundY = 0;
  /** 1 秒あたりの最大移動速度（数値爆発の防止） */
  maxSpeed = 60;
  collisionsEnabled = true;
  /** 直近の step() で記録された接触 */
  readonly contacts: Contact[] = [];
  /** 戦場の障害物リスト */
  obstacles: ObstacleCylinder[] = [];
  /** 断崖・橋ステージの奈落設定（null なら全面が地面） */
  chasm: ChasmSpec | null = null;

  private readonly contactPool: Contact[] = [];
  private readonly hash = new SpatialHash(0.5, 1024);
  private maxRadius = 0.1;
  private nextBodyId = 1;

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

  clear(): void {
    this.particles.length = 0;
    this.constraints.length = 0;
    this.contacts.length = 0;
  }

  /** 物理を dt 秒進める（固定 dt での呼び出しを推奨） */
  step(dt: number): void {
    this.contacts.length = 0;
    this.integrate(dt);
    for (let it = 0; it < this.iterations; it++) {
      const cs = this.constraints;
      for (let i = 0; i < cs.length; i++) cs[i].solve();
      this.solveGround(false);
      if (this.obstacles.length > 0) this.solveObstacles();
    }
    if (this.collisionsEnabled) this.solveParticleCollisions(dt);
    if (this.obstacles.length > 0) this.solveObstacles();
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
    const c = this.chasm;
    if (!c) return false;
    return x > c.minX && x < c.maxX && Math.abs(z) > c.bridgeHalfWidth;
  }

  private solveGround(applyFriction: boolean): void {
    const gy = this.groundY;
    const chasm = this.chasm;
    for (const p of this.particles) {
      // 奈落エリア上（またはすでに崖下へ落下中）の粒子は地面を y = -20 とする
      const inPit =
        chasm !== null &&
        (p.pos.y < gy - 0.18 || (p.pos.x > chasm.minX && p.pos.x < chasm.maxX && Math.abs(p.pos.z) > chasm.bridgeHalfWidth));
      const localGroundY = inPit ? -20 : gy;
      const minY = localGroundY + p.radius;

      // 崖下に落下した粒子が崖の側面へめり込まないように水平位置を制限
      if (chasm !== null && p.pos.y < gy - 0.05) {
        if (p.pos.x < chasm.minX + p.radius) p.pos.x = chasm.minX + p.radius;
        if (p.pos.x > chasm.maxX - p.radius) p.pos.x = chasm.maxX - p.radius;
        if (Math.abs(p.pos.z) < chasm.bridgeHalfWidth + p.radius) {
          p.pos.z = (p.pos.z >= 0 ? 1 : -1) * (chasm.bridgeHalfWidth + p.radius);
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

  private solveParticleCollisions(dt: number): void {
    const ps = this.particles;
    const n = ps.length;
    if (n < 2) return;
    const maxR = this.maxRadius;
    this.hash.spacing = Math.max(0.25, maxR * 2);
    this.hash.build(ps);
    const ids = this.hash.queryIds;
    for (let i = 0; i < n; i++) {
      const pi = ps[i];
      if (pi.flags & PF_NO_COLLIDE) continue;
      this.hash.query(pi.pos, pi.radius + maxR);
      const count = this.hash.queryCount;
      for (let q = 0; q < count; q++) {
        const j = ids[q];
        if (j <= i) continue;
        const pj = ps[j];
        if (pj.flags & PF_NO_COLLIDE) continue;
        if (pi.bodyId >= 0 && pi.bodyId === pj.bodyId) continue;
        const dx = pj.pos.x - pi.pos.x;
        const dy = pj.pos.y - pi.pos.y;
        const dz = pj.pos.z - pi.pos.z;
        const rr = pi.radius + pj.radius;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= rr * rr || d2 < 1e-12) continue;
        const w = pi.invMass + pj.invMass;
        if (w === 0) continue;
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
    }
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
