import { AnimationMixer, Group, LoopOnce, Quaternion, Vector3, type AnimationAction, type Mesh, type Object3D } from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { KabukunMotion, type KabukunMotionInput } from './KabukunMotion';

/**
 * かぶくんの 3D モデル（kabukun.glb をそのまま使う）。リグ・アニメ 10 種・目と口のモーフ入り。
 * 歩き・待機のアニメに、ぷにぷにの伸び縮みとよちよちの傾き（KabukunMotion）を重ねる。
 * 原点は足もと、正面は +z。
 */

/** モデルの大きさ（元は横幅 1.8 m・高さ 1.1 m。町の路地を通れる大きさに縮める） */
export const KABUKUN_GLB_SCALE = 0.72;
/** モデルの高さ（名札の位置に使う） */
export const KABUKUN_GLB_HEIGHT = 1.1 * KABUKUN_GLB_SCALE;

let loading: Promise<GLTF> | null = null;

/** モデルを読み込む（1 回だけ）。public/models/kabukun.glb */
export function loadKabukun(): Promise<GLTF> {
  loading ??= new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/kabukun.glb`);
  return loading;
}

export class KabukunActor {
  /** 位置と向きを置く外側 */
  readonly root = new Group();
  /** 伸び縮み・傾きをかける内側 */
  private readonly inner = new Group();
  /** ふっとびの回転をかける（体の真ん中を軸にする） */
  private readonly spinner = new Group();
  private readonly mixer: AnimationMixer;
  private readonly idle: AnimationAction | null;
  private readonly walk: AnimationAction | null;
  private readonly jump: AnimationAction | null;
  private readonly eyes: Mesh[] = [];
  private readonly mouths: Mesh[] = [];
  readonly motion = new KabukunMotion();
  private wasAir = false;
  private readonly model: Object3D;
  /** パンチで動かす右腕（肩の骨と手の骨） */
  private readonly armR: Object3D | null;
  private readonly handR: Object3D | null;
  /** パンチで向け直す前の肩の骨の向き（アニメが肩を動かさないときに、ずれがたまらないよう戻す） */
  private readonly armSaved = new Quaternion();
  private armTouched = false;

  constructor(gltf: GLTF) {
    const model = cloneSkinned(gltf.scene) as Object3D;
    this.model = model;
    this.armR = model.getObjectByName('arm_R') ?? null;
    this.handR = model.getObjectByName('hand_R') ?? null;
    model.scale.setScalar(KABUKUN_GLB_SCALE);
    model.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      // 骨で動くので、画面外判定で消えないようにする
      m.frustumCulled = false;
      if (!m.morphTargetDictionary) return;
      const name = `${m.name} ${m.parent?.name ?? ''}`;
      if (name.includes('Eyes')) this.eyes.push(m);
      else if (name.includes('Mouth')) this.mouths.push(m);
    });
    // 体の真ん中で回るよう、回転の軸を真ん中の高さに置いて、模型を半分下げる
    this.spinner.position.y = KABUKUN_GLB_HEIGHT / 2;
    model.position.y = -KABUKUN_GLB_HEIGHT / 2;
    this.spinner.add(model);
    this.inner.add(this.spinner);
    this.root.add(this.inner);
    this.mixer = new AnimationMixer(model);
    const action = (name: string): AnimationAction | null => {
      const clip = gltf.animations.find((a) => a.name === name);
      return clip ? this.mixer.clipAction(clip) : null;
    };
    this.idle = action('idle');
    this.walk = action('walk');
    this.jump = action('jump');
    this.idle?.play();
    if (this.walk) {
      this.walk.play();
      this.walk.setEffectiveWeight(0);
    }
    if (this.jump) {
      this.jump.setLoop(LoopOnce, 1);
      this.jump.clampWhenFinished = true;
    }
  }

  hit(): void {
    this.motion.hit();
  }

  punch(): void {
    this.motion.punch();
  }

  update(dt: number, inp: KabukunMotionInput): void {
    const pose = this.motion.update(dt, inp);
    // 跳んだ瞬間だけジャンプのアニメ
    if (inp.air && !this.wasAir && this.jump) {
      this.jump.reset().setEffectiveWeight(1).fadeIn(0.05).play();
    } else if (!inp.air && this.wasAir && this.jump) {
      this.jump.fadeOut(0.15);
    }
    this.wasAir = inp.air;
    if (this.walk) {
      this.walk.setEffectiveWeight(pose.walkWeight);
      this.walk.timeScale = pose.walkSpeed;
    }
    this.idle?.setEffectiveWeight(1 - pose.walkWeight);
    if (this.armTouched && this.armR) {
      this.armR.quaternion.copy(this.armSaved);
      this.armTouched = false;
    }
    this.mixer.update(dt);

    // ぷにぷに（体積を保つように横へふくらむ）とよちよち
    const sy = 1 + pose.stretch;
    const sxz = 1 / Math.sqrt(sy);
    this.inner.scale.set(sxz, sy, sxz);
    this.inner.rotation.set(pose.lean, pose.twist, pose.roll);
    this.inner.position.y = pose.bob;
    this.spinner.rotation.x = pose.spin;
    // アウトになったら仰向けに倒れる
    this.root.rotation.x = inp.alive ? 0 : -Math.PI / 2;

    if (pose.punchArm !== 0) this.aimArm(pose.punchArm);

    setMorphs(this.eyes, pose.eyes);
    setMorphs(this.mouths, pose.mouth);
  }

  /**
   * パンチの腕: アニメで決まった腕の向きから、前（+）か後ろ（-）へ向け直す。
   * 骨の軸の向きに頼らないよう、肩 → 手の向きを模型の空間で求め、目標の向きへ回す分だけ肩の骨に足す。
   */
  private aimArm(amount: number): void {
    const arm = this.armR;
    const hand = this.handR;
    if (!arm || !hand || !arm.parent) return;
    this.armSaved.copy(arm.quaternion);
    this.armTouched = true;
    this.root.updateMatrixWorld(true);
    const shoulder = arm.getWorldPosition(_v1);
    const wrist = hand.getWorldPosition(_v2);
    const cur = wrist.sub(shoulder).normalize();
    // 目標の向き（模型の正面は +z）を世界の向きへ
    const modelQ = this.model.getWorldQuaternion(_q1);
    const want = (amount > 0 ? _v3.set(0, 0.15, 1) : _v3.set(0.2, 0.35, -1)).normalize().applyQuaternion(modelQ);
    const full = _q2.setFromUnitVectors(cur, want);
    const delta = _q3.identity().slerp(full, Math.min(1, Math.abs(amount)));
    // 世界での回転を親の空間に直して、肩の骨の向きに足す
    const parentQ = arm.parent.getWorldQuaternion(_q4);
    const local = _q5.copy(parentQ).invert().multiply(delta).multiply(parentQ);
    arm.quaternion.premultiply(local);
  }

  dispose(): void {
    this.mixer.stopAllAction();
  }
}

const _v1 = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _q1 = new Quaternion();
const _q2 = new Quaternion();
const _q3 = new Quaternion();
const _q4 = new Quaternion();
const _q5 = new Quaternion();

/** モーフをなめらかに目標へ寄せる（指定のない名前は 0 へ） */
function setMorphs(meshes: Mesh[], target: Record<string, number>): void {
  for (const m of meshes) {
    const dict = m.morphTargetDictionary;
    const inf = m.morphTargetInfluences;
    if (!dict || !inf) continue;
    for (const [name, idx] of Object.entries(dict)) {
      const want = target[name] ?? 0;
      inf[idx] += (want - inf[idx]) * 0.35;
    }
  }
}
