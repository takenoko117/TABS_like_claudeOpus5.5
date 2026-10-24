import { Vector3 } from 'three';
import type { Particle } from './Particle';

/**
 * 拘束の種類
 * - equal: 常に既定長を保つ（骨）
 * - min:   既定長より縮まないようにする（関節の可動域制限など）
 * - max:   既定長より伸びないようにする（ロープなど）
 */
export type ConstraintMode = 'equal' | 'min' | 'max';

const _delta = new Vector3();

/** 2 粒子間の距離拘束（位置ベースで解く） */
export class DistanceConstraint {
  constructor(
    public a: Particle,
    public b: Particle,
    public rest: number,
    /** 1 反復あたりの補正率（0〜1） */
    public stiffness = 1,
    public mode: ConstraintMode = 'equal',
  ) {}

  solve(): void {
    const a = this.a;
    const b = this.b;
    _delta.subVectors(b.pos, a.pos);
    const dist = _delta.length();
    if (dist < 1e-9) return;
    if (this.mode === 'min' && dist >= this.rest) return;
    if (this.mode === 'max' && dist <= this.rest) return;
    const w = a.invMass + b.invMass;
    if (w === 0) return;
    // 質量の逆数に比例して両端を動かす
    const k = ((dist - this.rest) / (dist * w)) * this.stiffness;
    a.pos.addScaledVector(_delta, k * a.invMass);
    b.pos.addScaledVector(_delta, -k * b.invMass);
  }
}
