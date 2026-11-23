import { BufferGeometry, Float32BufferAttribute, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, BoxGeometry, type Scene, Vector3 } from 'three';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { Unit } from '../units/Unit';
import { TEAM_COLORS } from '../units/UnitTypes';
import { VoxelCharacterVisual, setVisualFxClock } from '../render/VoxelModel';
import type { OpenWorldSim, SimEvent } from './OpenWorldSim';
import type { TownUnit } from './TownWar';

/** 物理の刻み（本編・プレビューと同じ） */
const STEP = 1 / 60;
/** 本編のモデルで描く距離と、同時に描く数の上限 */
const DRAW_DIST = 110;
const DROP_DIST = 135;
const MAX_ACTORS = 40;
/** これより遠いと輪郭線と影を減らす */
const DETAIL_DIST = 45;

/** 1 体ぶんの、本編のラグドールとボクセルモデル */
interface Actor {
  unit: Unit;
  world: PhysicsWorld;
  visual: VoxelCharacterVisual;
  seq: number;
  acc: number;
  dead: boolean;
  far: boolean;
}

interface ShotFx {
  obj: Mesh | LineSegments;
  from: Vector3;
  to: Vector3;
  t: number;
  time: number;
  line: boolean;
}

const MAGIC_STYLES = ['lightning', 'gravity', 'frost', 'pyro', 'heal', 'necromancy', 'barrier', 'meteor', 'psychic', 'piano_performance'];

/**
 * 町の兵（TownWar）を、本編と同じラグドール（Unit + PhysicsWorld）とボクセルモデル（VoxelCharacterVisual）で描く。
 * 物理は兵ごとの小さな世界で動かし、ランニングマシンのように原点へ戻してから町の位置に置く（UnitPreviews と同じ方法）。
 */
export class TownActors {
  private readonly actors = new Map<number, Actor>();
  private readonly shots: ShotFx[] = [];
  private readonly shotGeo = new BoxGeometry(0.22, 0.22, 0.5);
  private readonly tmp = new Vector3();

  constructor(
    private readonly scene: Scene,
    private readonly sim: OpenWorldSim,
    private readonly addFx: (x: number, y: number, z: number, vx: number, vy: number, vz: number, type: number, life: number, size: number) => void,
  ) {}

  private create(u: TownUnit): Actor {
    const world = new PhysicsWorld();
    const unit = new Unit(world, u.type, u.team, new Vector3(0, 0, 0), 0);
    const visual = new VoxelCharacterVisual(unit);
    // 立ち姿に落ち着かせてから出す
    for (let k = 0; k < 30; k++) this.stepActor({ unit, world, visual, seq: u.attackSeq, acc: 0, dead: false, far: false }, 0);
    visual.sync();
    this.scene.add(visual.group);
    const a: Actor = { unit, world, visual, seq: u.attackSeq, acc: 0, dead: false, far: false };
    this.actors.set(u.id, a);
    return a;
  }

  private remove(id: number): void {
    const a = this.actors.get(id);
    if (!a) return;
    this.scene.remove(a.visual.group);
    a.visual.dispose();
    this.actors.delete(id);
  }

  /** 1 ステップ: 姿勢・攻撃のモーション・歩き。全身を原点へ戻す */
  private stepActor(a: Actor, walk: number): void {
    const u = a.unit;
    u.facing = 0;
    if (u.attackPhase !== 'none') {
      u.phaseTime += STEP;
      if (u.attackPhase === 'windup' && u.phaseTime >= Math.min(0.45, u.type.windup)) {
        u.attackPhase = 'strike';
        u.phaseTime = 0;
      } else if (u.attackPhase === 'strike' && u.phaseTime >= 0.28) {
        u.attackPhase = 'none';
        u.phaseTime = 0;
      }
    }
    u.previewStep(STEP, walk);
    a.world.step(STEP);
    const { x, z } = u.pelvis.pos;
    for (const p of a.world.particles) {
      p.pos.x -= x;
      p.pos.z -= z;
      p.prev.x -= x;
      p.prev.z -= z;
    }
    if (u.pelvis.pos.y < -0.5) {
      let lowest = Infinity;
      for (const p of a.world.particles) lowest = Math.min(lowest, p.pos.y);
      for (const p of a.world.particles) {
        p.pos.y -= lowest;
        p.prev.y = p.pos.y;
      }
    }
  }

  sync(dt: number, cam: Vector3): void {
    setVisualFxClock(performance.now() / 1000);
    const town = this.sim.town;
    const live = new Set<number>();
    // 近い順に、上限の数まで本編のモデルで描く
    const ranked = town.units
      .map((u) => ({ u, d: Math.hypot(u.pos.x - cam.x, u.pos.y - cam.y, u.pos.z - cam.z) }))
      .sort((a, b) => a.d - b.d);
    let shown = 0;
    for (const { u, d } of ranked) {
      live.add(u.id);
      let a = this.actors.get(u.id);
      const want = d < DRAW_DIST && shown < MAX_ACTORS;
      if (!want) {
        if (a && (d > DROP_DIST || shown >= MAX_ACTORS)) this.remove(u.id);
        else if (a) a.visual.group.visible = false;
        continue;
      }
      shown++;
      if (!a) a = this.create(u);
      a.visual.group.visible = true;
      if (u.state === 'dead' && !a.dead) {
        a.dead = true;
        a.unit.die();
      }
      if (u.attackSeq !== a.seq) {
        a.seq = u.attackSeq;
        if (!a.dead && a.unit.attackPhase === 'none') {
          a.unit.attackPhase = 'windup';
          a.unit.phaseTime = 0;
        }
      }
      // 足の動きは町での実際の速さに合わせる（本編の兵種の大きさで割る）
      const walk = a.dead ? 0 : Math.min(6, u.moveSpeed) / Math.max(1, u.scale * 0.6);
      a.acc = Math.min(a.acc + dt, STEP * 3);
      while (a.acc >= STEP) {
        this.stepActor(a, walk);
        a.acc -= STEP;
      }
      a.visual.group.position.set(u.pos.x, u.pos.y, u.pos.z);
      a.visual.group.rotation.y = u.yaw;
      const far = d > DETAIL_DIST;
      if (far !== a.far) {
        a.far = far;
        a.visual.setRenderDetail(far ? 0 : 2, far ? 0 : 2);
      }
      a.visual.sync();
    }
    for (const id of [...this.actors.keys()]) if (!live.has(id)) this.remove(id);
    this.syncShots(dt);
  }

  handleEvents(events: readonly SimEvent[]): void {
    for (const e of events) {
      if (e.kind === 'unit_hit') this.onHit(e.id, e.damage, e.killed, e.dir);
      else if (e.kind === 'unit_shot') this.addShot(e.from, e.to, e.style, e.team, e.time);
      else if (e.kind === 'unit_heal') {
        for (let k = 0; k < 6; k++) this.addFx(e.pos.x + (Math.random() - 0.5), e.pos.y + 0.5 + Math.random(), e.pos.z + (Math.random() - 0.5), 0, 1.5, 0, 3, 0.6, 0.12);
      } else if (e.kind === 'unit_burst') {
        for (let k = 0; k < 10; k++) this.addFx(e.pos.x, e.pos.y + 0.5, e.pos.z, (Math.random() - 0.5) * 3, 1 + Math.random() * 2, (Math.random() - 0.5) * 3, 2, 1.2, 0.4);
      }
    }
  }

  /** 被弾: 白く光らせ、当たった所のボクセルを削って落とし、体を押す */
  private onHit(id: number, damage: number, killed: boolean, dir: { x: number; y: number; z: number }): void {
    const a = this.actors.get(id);
    if (!a) return;
    a.visual.flashWhite(Math.min(1, 0.4 + damage / 60));
    const parts = a.world.particles.slice(0, 15);
    const hit = parts[Math.floor(Math.random() * parts.length)];
    if (hit) {
      const res = a.visual.applyHitDamage(hit, hit.pos.clone(), damage, killed);
      a.visual.group.updateMatrixWorld(true);
      for (const drop of res.drops.slice(0, 30)) {
        this.tmp.copy(drop.pos);
        a.visual.group.localToWorld(this.tmp);
        this.sim.destruction.spawnDebris(
          this.tmp.x,
          this.tmp.y,
          this.tmp.z,
          dir.x * 3 + (Math.random() - 0.5) * 3,
          2 + Math.random() * 3,
          dir.z * 3 + (Math.random() - 0.5) * 3,
          drop.color,
          Math.max(0.1, drop.size * 2),
        );
      }
    }
    // 体を押す（町の向きから兵の向きへ直す）
    const yaw = a.visual.group.rotation.y;
    const k = Math.min(7, 1 + damage * 0.06) * (killed ? 1.6 : 1);
    const lx = dir.x * Math.cos(yaw) - dir.z * Math.sin(yaw);
    const lz = dir.x * Math.sin(yaw) + dir.z * Math.cos(yaw);
    for (const p of a.world.particles) {
      p.prev.x -= lx * k * STEP;
      p.prev.z -= lz * k * STEP;
      p.prev.y -= (killed ? 3 : 1) * STEP;
    }
  }

  private addShot(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, style: string, team: number, time: number): void {
    const pal = TEAM_COLORS[team as 0 | 1 | 2 | 3];
    const line = time < 0.06;
    let obj: Mesh | LineSegments;
    if (line) {
      const geo = new BufferGeometry();
      geo.setAttribute('position', new Float32BufferAttribute([from.x, from.y, from.z, to.x, to.y, to.z], 3));
      const color = style === 'lightning' ? 0xa8d8ff : style === 'frost' ? 0xc8f0ff : style === 'ramiel_beam' || style === 'mouth_laser' ? pal.accent : 0xfff1a8;
      obj = new LineSegments(geo, new LineBasicMaterial({ color, transparent: true, opacity: 0.95 }));
    } else {
      const color = style === 'bow' ? 0x8a5a32 : MAGIC_STYLES.includes(style) ? pal.accent : style === 'pyro' || style === 'breath' ? 0xff7a2a : 0x3a3a3a;
      obj = new Mesh(this.shotGeo, new MeshBasicMaterial({ color }));
      obj.position.set(from.x, from.y, from.z);
      obj.lookAt(to.x, to.y, to.z);
    }
    this.scene.add(obj);
    this.shots.push({ obj, from: new Vector3(from.x, from.y, from.z), to: new Vector3(to.x, to.y, to.z), t: 0, time: Math.max(0.08, time), line });
  }

  private syncShots(dt: number): void {
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      s.t += dt;
      if (!s.line) {
        const k = Math.min(1, s.t / s.time);
        s.obj.position.lerpVectors(s.from, s.to, k);
        // 放物線のように少し山なりに
        s.obj.position.y += Math.sin(k * Math.PI) * Math.min(3, s.from.distanceTo(s.to) * 0.08);
        if (Math.random() < 0.5) this.addFx(s.obj.position.x, s.obj.position.y, s.obj.position.z, 0, 0.3, 0, 1, 0.4, 0.12);
      }
      if (s.t >= s.time) {
        this.scene.remove(s.obj);
        if (s.line) s.obj.geometry.dispose();
        (s.obj.material as MeshBasicMaterial).dispose();
        this.shots.splice(i, 1);
      }
    }
  }

  dispose(): void {
    for (const id of [...this.actors.keys()]) this.remove(id);
    for (const s of this.shots) this.scene.remove(s.obj);
    this.shots.length = 0;
    this.shotGeo.dispose();
  }
}
