import { Vector3 } from 'three';

/** 粒子フラグ: 他の粒子との接触イベントを記録する（武器の当たり判定などに使用） */
export const PF_RECORD_CONTACT = 1 << 0;
/** 粒子フラグ: 他の粒子との衝突判定を行わない（地面との判定のみ） */
export const PF_NO_COLLIDE = 1 << 1;

export interface ParticleOptions {
  /** 質量（0 以下で固定点扱い） */
  mass?: number;
  /** 衝突半径 */
  radius?: number;
  /** 地面摩擦係数（0〜1、1 で接地時に水平移動が完全停止） */
  friction?: number;
  /** 所属する剛体（ボディ）ID。同じ ID 同士は衝突しない */
  bodyId?: number;
  /** PF_* フラグ */
  flags?: number;
}

/**
 * Verlet 積分で動く質点。
 * 速度は「現在位置 - 前回位置」で暗黙的に表現される。
 */
export class Particle {
  readonly pos = new Vector3();
  readonly prev = new Vector3();
  /** 1 ステップ分の外力の蓄積（ステップ後に自動でクリアされる） */
  readonly force = new Vector3();
  mass = 1;
  invMass = 1;
  radius: number;
  friction: number;
  bodyId: number;
  flags: number;
  /** 任意の所有者（ユニットなど）。物理エンジン自体は参照しない */
  owner: unknown = null;
  /** 直近のステップで地面に接していたか */
  grounded = false;

  constructor(position: Vector3, opts: ParticleOptions = {}) {
    this.pos.copy(position);
    this.prev.copy(position);
    this.setMass(opts.mass ?? 1);
    this.radius = opts.radius ?? 0.1;
    this.friction = opts.friction ?? 0.3;
    this.bodyId = opts.bodyId ?? -1;
    this.flags = opts.flags ?? 0;
  }

  setMass(mass: number): void {
    this.mass = mass;
    this.invMass = mass > 0 ? 1 / mass : 0;
  }

  /** 現在の速度を out に書き込んで返す */
  getVelocity(dt: number, out: Vector3): Vector3 {
    return out.subVectors(this.pos, this.prev).divideScalar(dt);
  }

  /** 速度を直接加算する（撃力の適用）。前回位置をずらすことで実現 */
  addVelocity(dv: Vector3, dt: number): void {
    this.prev.addScaledVector(dv, -dt);
  }

  /** 速度ゼロで指定位置へ移動 */
  teleport(p: Vector3): void {
    this.pos.copy(p);
    this.prev.copy(p);
  }
}
