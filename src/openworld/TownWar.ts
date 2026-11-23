import { TEAM_COLORS, TEAM_NAMES, UNIT_TYPE_LIST, UNIT_TYPES, type Team, type UnitType, type UnitTypeId } from '../units/UnitTypes';
import {
  OW_GRAVITY,
  OW_ROAD_WIDTH,
  OW_TOWN_BLAST,
  OW_TOWN_CORPSE_TIME,
  OW_TOWN_CRUSH_SCALE,
  OW_TOWN_FACTIONS,
  OW_TOWN_HITSCAN,
  OW_TOWN_MAX_RANGE,
  OW_TOWN_MAX_WARS,
  OW_TOWN_PLAYER_GRUDGE,
  OW_TOWN_POP,
  OW_TOWN_RALLY,
  OW_TOWN_RESPAWN,
  OW_TOWN_SIGHT,
  OW_TOWN_SKIRMISH_BASE,
  OW_TOWN_SKIRMISH_PER_TENSION,
  OW_TOWN_SQUAD,
  OW_TOWN_TENSION_KILL,
  OW_TOWN_TENSION_RATE,
  OW_TOWN_WAR_TIME,
} from './OpenWorldConfig';
import type { DestructionSystem } from './Destruction';
import type { V3, VoxelWorld } from './VoxelWorld';
import { ROAD_ORIGINS, SIDEWALK_LINES } from './WorldGen';

/**
 * 町に住む本編のユニット（4 つの陣営）。
 * ふだんは自分の街区を歩き回り、立ち話や素振りをして暮らしている。
 * 別の陣営と出会うと緊張に応じて小競り合いになり、緊張が高まりきると部隊を組んで相手の拠点へ攻め込む（戦争）。
 * Three.js には依存しない。見た目は OpenWorldRenderer が本編のラグドールとボクセルモデルで描く。
 */

export type TownState = 'life' | 'fight' | 'march' | 'dead';
export type TownActivity = 'walk' | 'idle' | 'chat' | 'train';

export interface TownUnit {
  id: number;
  typeId: UnitTypeId;
  type: UnitType;
  team: Team;
  pos: V3;
  vel: V3;
  yaw: number;
  hp: number;
  maxHp: number;
  scale: number;
  half: number;
  height: number;
  /** 戦いで走る速さ */
  runSpeed: number;
  /** 攻撃の届く距離・ダメージ・攻撃の間隔 */
  range: number;
  damage: number;
  cycle: number;
  ranged: boolean;
  blast: number;
  hitscan: boolean;
  healer: boolean;
  state: TownState;
  activity: TownActivity;
  timer: number;
  /** 歩道の交点（いま向かっている点・最終目的地） */
  nodeA: number;
  nodeB: number;
  destA: number;
  destB: number;
  target: TownUnit | 'player' | null;
  attackCd: number;
  /** 攻撃するたびに増える（描画が攻撃のモーションを始める合図） */
  attackSeq: number;
  /** 吹き飛ばされて動けない残り時間 */
  stun: number;
  stuck: number;
  /** 回り道の行き先（歩道の交点） */
  detour: { x: number; z: number } | null;
  onGround: boolean;
  /** いまの移動の速さ（描画の足の動き） */
  moveSpeed: number;
  warId: number;
  /** 敵を探す間隔 */
  scan: number;
}

export interface TownShot {
  from: V3;
  to: V3;
  /** 届くまでの残り秒 */
  time: number;
  damage: number;
  blast: number;
  team: Team;
  target: TownUnit | 'player' | null;
  style: string;
  shooter: number;
}

export interface TownWarInfo {
  id: number;
  attacker: Team;
  defender: Team;
  timer: number;
  /** 攻め手が拠点を押さえ続けている秒数 */
  hold: number;
}

export type TownEvent =
  | { kind: 'unit_hit'; id: number; damage: number; killed: boolean; dir: V3 }
  | { kind: 'unit_die'; id: number; pos: V3; team: Team }
  | { kind: 'unit_burst'; id: number; pos: V3 }
  | { kind: 'unit_shot'; from: V3; to: V3; style: string; team: Team; time: number }
  | { kind: 'unit_heal'; pos: V3 }
  | { kind: 'town_news'; text: string; level: 'info' | 'skirmish' | 'war' | 'end' };

/** TownWar が世界に触るための窓口（OpenWorldSim が実装する） */
export interface TownHost {
  readonly world: VoxelWorld;
  readonly destruction: DestructionSystem;
  readonly player: { pos: V3; vehicle: { pos: V3 } | null };
  readonly events: { push(e: TownEvent): void };
  /** 兵の攻撃がプレイヤーに当たった（乗り物なら乗り物が傷み、歩きなら吹き飛ぶ） */
  hurtPlayer(dir: V3, damage: number): void;
  scarePeds(at: V3, radius: number): void;
  moveTownBox(pos: V3, vel: V3, half: number, height: number, dt: number, wasOnGround: boolean): boolean;
}

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** 陣営の住む街区（歩道の交点の添字の範囲）。赤 = 北西・青 = 北東・黄 = 南西・緑 = 南東 */
export function factionHome(team: Team): { a0: number; a1: number; b0: number; b1: number } {
  const half = SIDEWALK_LINES.length / 2;
  const east = team === 1 || team === 3;
  const south = team === 2 || team === 3;
  return { a0: east ? half : 0, a1: east ? SIDEWALK_LINES.length - 1 : half - 1, b0: south ? half : 0, b1: south ? SIDEWALK_LINES.length - 1 : half - 1 };
}

/** 陣営の拠点（街区の奥の交差点の真ん中） */
export function factionBase(team: Team): { x: number; z: number; a: number; b: number } {
  const last = ROAD_ORIGINS.length - 2;
  const rx = team === 1 || team === 3 ? last : 1;
  const rz = team === 2 || team === 3 ? last : 1;
  return { x: ROAD_ORIGINS[rx] + OW_ROAD_WIDTH / 2, z: ROAD_ORIGINS[rz] + OW_ROAD_WIDTH / 2, a: rx * 2, b: rz * 2 };
}

/** 町に出てくる兵種と出やすさ（安い兵ほど多く、巨大な兵はまれ） */
export const TOWN_ROSTER: readonly { id: UnitTypeId; weight: number }[] = UNIT_TYPE_LIST.filter((t) => t.id !== 'decoy').map((t) => ({
  id: t.id,
  weight: t.cost <= 300 ? 1 : t.cost <= 800 ? 0.3 : t.cost <= 1500 ? 0.08 : 0.04,
}));

/** 兵種の町での戦い方（ダメージ・攻撃の間隔・届く距離） */
export function townCombatStats(t: UnitType): { damage: number; cycle: number; range: number; ranged: boolean; blast: number; hitscan: boolean; healer: boolean } {
  const cycle = Math.max(0.8, t.windup + t.strike + t.recover + t.cooldown);
  const base = t.weapon?.damage ?? t.projectile?.damage ?? 15 + t.cost * 0.04;
  // 大きい兵ほど一撃が重い
  const damage = base * (t.weapon ? Math.max(1, t.scale * 0.8) : 1);
  const ranged = t.range > 3;
  const range = ranged ? Math.min(OW_TOWN_MAX_RANGE, t.range) : t.range * t.scale + 0.6;
  return {
    damage,
    cycle,
    range,
    ranged,
    blast: OW_TOWN_BLAST[t.style] ?? 0,
    hitscan: OW_TOWN_HITSCAN.includes(t.style),
    healer: t.style === 'heal',
  };
}

const dist2 = (a: { x: number; z: number }, b: { x: number; z: number }): number => Math.hypot(a.x - b.x, a.z - b.z);

export class TownWar {
  readonly units: TownUnit[] = [];
  readonly shots: TownShot[] = [];
  readonly wars: TownWarInfo[] = [];
  /** 陣営どうしの緊張（0〜1。1 で戦争） */
  readonly tension: number[][];
  private readonly tensionRate: number[][];
  /** 補充を待っている陣営（陣営ごとの残り秒の列） */
  private readonly respawnQueue: number[][] = [];
  /** プレイヤーへの敵意が続く残り秒（陣営ごと） */
  readonly grudge: number[];
  private nextId = 100000;
  private nextWarId = 1;
  private newsCooldown = 0;
  /** 戦った数・倒された数（陣営ごと） */
  readonly kills: number[];

  constructor(
    private readonly host: TownHost,
    private readonly rng: () => number,
    populate = true,
  ) {
    this.tension = Array.from({ length: OW_TOWN_FACTIONS }, () => new Array(OW_TOWN_FACTIONS).fill(0));
    this.tensionRate = Array.from({ length: OW_TOWN_FACTIONS }, () => new Array(OW_TOWN_FACTIONS).fill(0));
    for (let i = 0; i < OW_TOWN_FACTIONS; i++) {
      for (let j = i + 1; j < OW_TOWN_FACTIONS; j++) {
        // 最初から仲の悪い組み合わせもある
        const t = 0.2 + rng() * 0.5;
        const r = 0.5 + rng();
        this.tension[i][j] = this.tension[j][i] = t;
        this.tensionRate[i][j] = this.tensionRate[j][i] = r;
      }
    }
    this.grudge = new Array(OW_TOWN_FACTIONS).fill(0);
    this.kills = new Array(OW_TOWN_FACTIONS).fill(0);
    for (let t = 0; t < OW_TOWN_FACTIONS; t++) this.respawnQueue.push([]);
    if (populate) {
      for (let t = 0; t < OW_TOWN_FACTIONS; t++) for (let k = 0; k < OW_TOWN_POP; k++) this.spawn(t as Team, this.pickType(), true);
    }
  }

  private pickType(): UnitTypeId {
    const total = TOWN_ROSTER.reduce((s, r) => s + r.weight, 0);
    let x = this.rng() * total;
    for (const r of TOWN_ROSTER) {
      x -= r.weight;
      if (x <= 0) return r.id;
    }
    return TOWN_ROSTER[0].id;
  }

  /** 兵を出す。scatter なら自分の街区のどこか、そうでなければ拠点に出る */
  spawn(team: Team, typeId: UnitTypeId, scatter = false, at?: { x: number; z: number }): TownUnit {
    const type = UNIT_TYPES[typeId];
    const home = factionHome(team);
    const base = factionBase(team);
    let a = base.a;
    let b = base.b;
    if (scatter) {
      a = home.a0 + Math.floor(this.rng() * (home.a1 - home.a0 + 1));
      b = home.b0 + Math.floor(this.rng() * (home.b1 - home.b0 + 1));
    }
    const x = at?.x ?? SIDEWALK_LINES[a] + (this.rng() - 0.5) * 0.6;
    const z = at?.z ?? SIDEWALK_LINES[b] + (this.rng() - 0.5) * 0.6;
    const w = this.host.world;
    const y = w.topSolidY(Math.floor(x), Math.floor(z)) + 1;
    const stats = townCombatStats(type);
    const scale = type.scale;
    const u: TownUnit = {
      id: this.nextId++,
      typeId,
      type,
      team,
      pos: { x, y, z },
      vel: { x: 0, y: 0, z: 0 },
      yaw: this.rng() * Math.PI * 2,
      hp: type.hp,
      maxHp: type.hp,
      scale,
      half: Math.min(1.2, 0.3 * scale),
      height: Math.min(5.5, 1.8 * scale),
      runSpeed: Math.min(7, Math.max(2.2, type.speed * 1.3)),
      ...stats,
      state: 'life',
      activity: 'idle',
      timer: this.rng() * 3,
      nodeA: a,
      nodeB: b,
      destA: a,
      destB: b,
      target: null,
      attackCd: this.rng(),
      attackSeq: 0,
      stun: 0,
      stuck: 0,
      detour: null,
      onGround: true,
      moveSpeed: 0,
      warId: 0,
      scan: this.rng() * 0.3,
    };
    this.units.push(u);
    return u;
  }

  private emit(e: TownEvent): void {
    this.host.events.push(e);
  }

  private news(text: string, level: 'info' | 'skirmish' | 'war' | 'end'): void {
    this.emit({ kind: 'town_news', text, level });
  }

  /** プレイヤーの位置（乗り物に乗っていれば乗り物） */
  private playerPos(): V3 {
    const p = this.host.player;
    return p.vehicle ? { x: p.vehicle.pos.x, y: p.vehicle.pos.y, z: p.vehicle.pos.z } : p.pos;
  }

  private targetPos(t: TownUnit | 'player'): V3 {
    return t === 'player' ? this.playerPos() : t.pos;
  }

  private targetAlive(t: TownUnit | 'player' | null): boolean {
    if (!t) return false;
    if (t === 'player') return true;
    return t.state !== 'dead';
  }

  atWar(a: Team, b: Team): TownWarInfo | null {
    return this.wars.find((w) => (w.attacker === a && w.defender === b) || (w.attacker === b && w.defender === a)) ?? null;
  }

  // ---- 毎ステップ ----

  step(dt: number): void {
    this.newsCooldown = Math.max(0, this.newsCooldown - dt);
    for (let t = 0; t < OW_TOWN_FACTIONS; t++) this.grudge[t] = Math.max(0, this.grudge[t] - dt);
    this.updateTension(dt);
    this.updateWars(dt);
    for (const u of this.units) this.updateUnit(u, dt);
    this.separate();
    this.updateShots(dt);
    this.updateCorpses(dt);
    this.updateRespawn(dt);
  }

  private updateTension(dt: number): void {
    for (let i = 0; i < OW_TOWN_FACTIONS; i++) {
      for (let j = i + 1; j < OW_TOWN_FACTIONS; j++) {
        if (this.atWar(i as Team, j as Team)) continue;
        const v = Math.min(1, this.tension[i][j] + OW_TOWN_TENSION_RATE * this.tensionRate[i][j] * dt);
        this.tension[i][j] = this.tension[j][i] = v;
        if (v >= 1 && this.wars.length < OW_TOWN_MAX_WARS) {
          const busy = (t: number) => this.wars.some((w) => w.attacker === t || w.defender === t);
          if (!busy(i) && !busy(j)) this.declareWar(i as Team, j as Team);
        }
      }
    }
  }

  private alive(team: Team): TownUnit[] {
    return this.units.filter((u) => u.team === team && u.state !== 'dead');
  }

  /** 戦争を始める。人数の多い側が攻め込む */
  declareWar(a: Team, b: Team): TownWarInfo {
    const [attacker, defender] = this.alive(a).length >= this.alive(b).length ? [a, b] : [b, a];
    const war: TownWarInfo = { id: this.nextWarId++, attacker, defender, timer: OW_TOWN_WAR_TIME, hold: 0 };
    this.wars.push(war);
    const base = factionBase(defender);
    const squad = this.alive(attacker)
      .sort((u, v) => dist2(u.pos, base) - dist2(v.pos, base))
      .slice(0, OW_TOWN_SQUAD);
    for (const u of squad) {
      u.state = 'march';
      u.warId = war.id;
      u.target = null;
      u.destA = base.a + (this.rng() < 0.5 ? 0 : 1);
      u.destB = base.b + (this.rng() < 0.5 ? 0 : 1);
    }
    // 守る側は拠点に集まる
    const home = factionBase(defender);
    for (const u of this.alive(defender)) {
      if (u.state === 'fight') continue;
      u.state = 'march';
      u.warId = war.id;
      u.destA = home.a + (this.rng() < 0.5 ? 0 : 1);
      u.destB = home.b + (this.rng() < 0.5 ? 0 : 1);
    }
    this.news(`${TEAM_NAMES[attacker]}が${TEAM_NAMES[defender]}の街区へ侵攻を開始！`, 'war');
    return war;
  }

  private endWar(war: TownWarInfo, text: string): void {
    this.wars.splice(this.wars.indexOf(war), 1);
    this.tension[war.attacker][war.defender] = this.tension[war.defender][war.attacker] = 0.1;
    for (const u of this.units) {
      if (u.warId !== war.id) continue;
      u.warId = 0;
      if (u.state === 'march') this.toLife(u);
    }
    this.news(text, 'end');
  }

  private updateWars(dt: number): void {
    for (const war of [...this.wars]) {
      war.timer -= dt;
      const squad = this.units.filter((u) => u.warId === war.id && u.team === war.attacker && u.state !== 'dead');
      const base = factionBase(war.defender);
      if (squad.length === 0) {
        this.endWar(war, `${TEAM_NAMES[war.defender]}が${TEAM_NAMES[war.attacker]}の侵攻を退けた！`);
        continue;
      }
      const atBase = squad.filter((u) => dist2(u.pos, base) < 12).length;
      const defenders = this.alive(war.defender).filter((u) => dist2(u.pos, base) < 22).length;
      if (atBase > 0 && defenders === 0) war.hold += dt;
      else war.hold = Math.max(0, war.hold - dt * 0.5);
      if (war.hold > 8) {
        this.endWar(war, `${TEAM_NAMES[war.attacker]}が${TEAM_NAMES[war.defender]}の拠点を制圧した！`);
        continue;
      }
      if (war.timer <= 0) this.endWar(war, `${TEAM_NAMES[war.attacker]}と${TEAM_NAMES[war.defender]}の戦争は痛み分けに終わった`);
    }
  }

  private toLife(u: TownUnit): void {
    u.state = 'life';
    u.target = null;
    u.detour = null;
    u.activity = 'idle';
    u.timer = 1 + this.rng() * 2;
    this.snapToNode(u);
    u.destA = u.nodeA;
    u.destB = u.nodeB;
  }

  /** いちばん近い歩道の交点を次の目的地にする */
  private snapToNode(u: TownUnit): void {
    let ba = 0;
    let bb = 0;
    SIDEWALK_LINES.forEach((x, i) => {
      if (Math.abs(x - u.pos.x) < Math.abs(SIDEWALK_LINES[ba] - u.pos.x)) ba = i;
      if (Math.abs(x - u.pos.z) < Math.abs(SIDEWALK_LINES[bb] - u.pos.z)) bb = i;
    });
    u.nodeA = ba;
    u.nodeB = bb;
  }

  // ---- 1 体の更新 ----

  private updateUnit(u: TownUnit, dt: number): void {
    if (u.state === 'dead') {
      u.vel.y -= OW_GRAVITY * dt;
      u.vel.x *= Math.pow(0.05, dt);
      u.vel.z *= Math.pow(0.05, dt);
      u.onGround = this.host.moveTownBox(u.pos, u.vel, u.half, 0.5, dt, u.onGround);
      u.moveSpeed = 0;
      return;
    }
    u.attackCd -= dt;
    u.scan -= dt;
    if (u.stun > 0) {
      u.stun -= dt;
      u.vel.y -= OW_GRAVITY * dt;
      if (u.onGround) {
        u.vel.x *= Math.pow(0.02, dt);
        u.vel.z *= Math.pow(0.02, dt);
      }
      u.onGround = this.host.moveTownBox(u.pos, u.vel, u.half, u.height, dt, u.onGround);
      u.moveSpeed = 0;
      return;
    }
    if (u.scan <= 0) {
      u.scan = 0.3;
      this.lookAround(u);
    }
    let goal: { x: number; z: number } | null = null;
    let speed = 0;
    if (u.state === 'fight') {
      const r = this.fight(u);
      goal = r.goal;
      speed = r.goal ? u.runSpeed : 0;
    } else if (u.state === 'march') {
      goal = this.walkNodes(u);
      speed = u.runSpeed * 0.85;
      if (!goal) {
        // 拠点に着いたら、その場で敵を待つ
        u.yaw += dt * 0.5;
      }
    } else {
      const r = this.live(u, dt);
      goal = r;
      speed = Math.min(1.8, 1.2 * Math.max(1, u.scale * 0.7));
    }
    if (u.detour) {
      goal = u.detour;
      if (dist2(u.pos, u.detour) < 0.6) u.detour = null;
    }
    this.moveToward(u, goal, speed, dt);
  }

  /** ふだんの暮らし: 街区の歩道を歩き、立ち止まって話したり素振りをしたりする */
  private live(u: TownUnit, dt: number): { x: number; z: number } | null {
    if (u.activity !== 'walk') {
      u.timer -= dt;
      if (u.activity === 'train' && u.attackCd <= 0) {
        u.attackCd = u.cycle * 1.6;
        u.attackSeq++;
      }
      if (u.activity === 'chat') {
        const friend = this.nearest(u, (o) => o.team === u.team && o !== u && o.state === 'life', 4);
        if (friend) u.yaw = Math.atan2(friend.pos.x - u.pos.x, friend.pos.z - u.pos.z);
      }
      if (u.timer <= 0) this.chooseActivity(u);
      return null;
    }
    const g = this.walkNodes(u);
    if (!g) this.chooseActivity(u);
    return g;
  }

  private chooseActivity(u: TownUnit): void {
    const r = this.rng();
    const friend = this.nearest(u, (o) => o.team === u.team && o !== u && o.state === 'life', 4);
    if (friend && r < 0.35) {
      u.activity = 'chat';
      u.timer = 3 + this.rng() * 5;
    } else if (r < 0.5) {
      u.activity = 'train';
      u.timer = 2 + this.rng() * 3;
    } else if (r < 0.62) {
      u.activity = 'idle';
      u.timer = 1.5 + this.rng() * 4;
    } else {
      u.activity = 'walk';
      // たいていは自分の街区、ときどき町の真ん中や他の街区へ出かける
      const home = factionHome(u.team);
      const n = SIDEWALK_LINES.length;
      if (this.rng() < 0.75) {
        u.destA = home.a0 + Math.floor(this.rng() * (home.a1 - home.a0 + 1));
        u.destB = home.b0 + Math.floor(this.rng() * (home.b1 - home.b0 + 1));
      } else {
        u.destA = Math.floor(this.rng() * n);
        u.destB = Math.floor(this.rng() * n);
      }
    }
  }

  /**
   * 歩道の交点を 1 つずつたどって目的地へ向かう。次の行き先（着いていれば null）を返す。
   * 交点どうしは必ず歩道か横断歩道でつながっているので、建物にぶつからない。
   */
  private walkNodes(u: TownUnit): { x: number; z: number } | null {
    const target = { x: SIDEWALK_LINES[u.nodeA], z: SIDEWALK_LINES[u.nodeB] };
    if (dist2(u.pos, target) > 0.5) return target;
    if (u.nodeA === u.destA && u.nodeB === u.destB) return null;
    // 残りの多い軸を先に進む（少しゆらぎを入れて全員が同じ道を通らないように）
    const da = u.destA - u.nodeA;
    const db = u.destB - u.nodeB;
    if (da !== 0 && (db === 0 || Math.abs(da) + this.rng() * 2 > Math.abs(db))) u.nodeA += Math.sign(da);
    else u.nodeB += Math.sign(db);
    return { x: SIDEWALK_LINES[u.nodeA], z: SIDEWALK_LINES[u.nodeB] };
  }

  private nearest(u: TownUnit, pred: (o: TownUnit) => boolean, radius: number): TownUnit | null {
    let best: TownUnit | null = null;
    let bd = radius;
    for (const o of this.units) {
      if (o.state === 'dead' || !pred(o)) continue;
      const d = dist2(u.pos, o.pos);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  }

  /** 見える所に敵がいないか調べ、戦いを始めるか決める */
  private lookAround(u: TownUnit): void {
    // プレイヤーに恨みがあれば襲いかかる
    if (this.grudge[u.team] > 0 && u.state !== 'fight') {
      const pp = this.playerPos();
      if (dist2(u.pos, pp) < OW_TOWN_SIGHT * 1.6) {
        this.engage(u, 'player');
        return;
      }
    }
    if (u.state === 'fight') return;
    const sightEnemy = this.nearest(u, (o) => o.team !== u.team, OW_TOWN_SIGHT);
    if (!sightEnemy) return;
    const tension = this.tension[u.team][sightEnemy.team];
    const war = this.atWar(u.team, sightEnemy.team);
    const hostile = sightEnemy.state === 'fight' || sightEnemy.state === 'march' || u.state === 'march' || !!war;
    // 見かけるだけでも少しずつ険悪になる
    this.tension[u.team][sightEnemy.team] = this.tension[sightEnemy.team][u.team] = Math.min(1, tension + 0.0015);
    if (hostile) {
      this.engage(u, sightEnemy);
      return;
    }
    const p = (OW_TOWN_SKIRMISH_BASE + tension * OW_TOWN_SKIRMISH_PER_TENSION) * 0.3;
    if (this.rng() < p) {
      this.engage(u, sightEnemy);
      this.engage(sightEnemy, u);
      if (this.newsCooldown <= 0) {
        this.newsCooldown = 6;
        this.news(`${TEAM_NAMES[u.team]}と${TEAM_NAMES[sightEnemy.team]}が小競り合いを始めた`, 'skirmish');
      }
      this.rally(u, sightEnemy);
      this.rally(sightEnemy, u);
    }
  }

  /** 近くの仲間が加勢する */
  private rally(u: TownUnit, enemy: TownUnit | 'player'): void {
    for (const o of this.units) {
      if (o === u || o.team !== u.team || o.state === 'dead' || o.state === 'fight') continue;
      if (dist2(o.pos, u.pos) > OW_TOWN_RALLY) continue;
      this.engage(o, enemy);
    }
  }

  private engage(u: TownUnit, target: TownUnit | 'player'): void {
    if (u.state === 'dead') return;
    if (u.state !== 'fight') u.timer = 0;
    u.state = 'fight';
    u.target = target;
    u.activity = 'walk';
  }

  /** 戦い: 届く距離まで近づいて攻撃する。動く先（止まるなら null）を返す */
  private fight(u: TownUnit): { goal: { x: number; z: number } | null } {
    if (!this.targetAlive(u.target) || (u.target === 'player' && this.grudge[u.team] <= 0)) {
      // 次の敵を探す。いなければ暮らし（戦争中なら行軍）に戻る
      const next = this.nearest(u, (o) => o.team !== u.team && (o.state === 'fight' || o.state === 'march' || !!this.atWar(u.team, o.team)), OW_TOWN_SIGHT * 1.3);
      if (next) u.target = next;
      else {
        u.target = null;
        if (u.warId && this.wars.some((w) => w.id === u.warId)) {
          u.state = 'march';
          this.snapToNode(u);
        } else this.toLife(u);
        return { goal: null };
      }
    }
    const tgt = u.target!;
    if (u.healer) {
      // 癒やしの賢者は傷ついた仲間を癒やす
      const hurt = this.nearest(u, (o) => o.team === u.team && o.hp < o.maxHp * 0.8, u.range);
      if (hurt && u.attackCd <= 0) {
        u.attackCd = u.cycle;
        u.attackSeq++;
        hurt.hp = Math.min(hurt.maxHp, hurt.hp + u.damage * 1.5);
        this.emit({ kind: 'unit_heal', pos: { ...hurt.pos } });
      }
    }
    const tp = this.targetPos(tgt);
    const tScale = tgt === 'player' ? 1 : tgt.scale;
    const d = dist2(u.pos, tp);
    u.yaw = Math.atan2(tp.x - u.pos.x, tp.z - u.pos.z);
    const reach = u.range + (tgt === 'player' ? 0.4 : tgt.half);
    if (d > OW_TOWN_SIGHT * 3) {
      u.target = null;
      return { goal: null };
    }
    let blocked = false;
    if (u.ranged && d <= reach) {
      // 遠距離は射線が通るか確かめる
      const from = { x: u.pos.x, y: u.pos.y + u.height * 0.7, z: u.pos.z };
      const to = { x: tp.x, y: tp.y + 1.2 * tScale, z: tp.z };
      const dir = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
      const len = Math.hypot(dir.x, dir.y, dir.z);
      const hit = this.host.world.raycast(from, dir, len);
      blocked = !!hit && hit.dist < len - 1;
      // 爆発する攻撃なら、ふさいでいる建物ごと吹き飛ばす
      if (blocked && u.blast > 0 && hit!.dist > 3) blocked = false;
    }
    if (d <= reach && !blocked) {
      if (u.attackCd <= 0) this.attack(u, tgt, tp);
      return { goal: null };
    }
    return { goal: { x: tp.x, z: tp.z } };
  }

  private attack(u: TownUnit, tgt: TownUnit | 'player', tp: V3): void {
    u.attackCd = u.cycle * (0.85 + this.rng() * 0.3);
    u.attackSeq++;
    const tScale = tgt === 'player' ? 1 : tgt.scale;
    this.host.scarePeds(u.pos, 12);
    if (!u.ranged) {
      const dir = this.norm({ x: tp.x - u.pos.x, y: 0, z: tp.z - u.pos.z });
      this.hitTarget(tgt, u.damage, dir, u);
      return;
    }
    const from = { x: u.pos.x + Math.sin(u.yaw) * u.half, y: u.pos.y + u.height * 0.7, z: u.pos.z + Math.cos(u.yaw) * u.half };
    // 遠距離は少しばらつく
    const spread = u.hitscan ? 0.4 : 1;
    const to = { x: tp.x + (this.rng() - 0.5) * spread, y: tp.y + 1 * tScale, z: tp.z + (this.rng() - 0.5) * spread };
    const dist = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    const speed = u.hitscan ? 220 : Math.max(18, u.type.projectile?.speed ?? 24);
    const time = dist / speed;
    this.shots.push({ from, to, time, damage: u.damage, blast: u.blast, team: u.team, target: tgt, style: u.type.style, shooter: u.id });
    this.emit({ kind: 'unit_shot', from, to, style: u.type.style, team: u.team, time });
  }

  private norm(v: V3): V3 {
    const l = Math.hypot(v.x, v.y, v.z) || 1;
    return { x: v.x / l, y: v.y / l, z: v.z / l };
  }

  private hitTarget(tgt: TownUnit | 'player', damage: number, dir: V3, attacker: TownUnit | null): void {
    if (tgt === 'player') {
      this.host.hurtPlayer(dir, damage);
      return;
    }
    this.damage(tgt, damage, dir, attacker ? { team: attacker.team, unit: attacker } : null);
  }

  /**
   * 兵にダメージを与える。source が null ならプレイヤーの攻撃（その陣営がプレイヤーを恨む）、
   * 'blast' なら爆風（誰のものか分からない）。
   */
  damage(u: TownUnit, amount: number, dir: V3, source: { team: Team; unit: TownUnit | null } | null | 'blast'): void {
    if (u.state === 'dead' || amount <= 0) return;
    u.hp -= amount;
    const killed = u.hp <= 0;
    // ノックバック（大きい兵ほど動かない）
    const kb = Math.min(14, (amount * 0.12) / Math.max(1, u.scale * u.scale));
    u.vel.x += dir.x * kb;
    u.vel.z += dir.z * kb;
    if (kb > 4) {
      u.vel.y = Math.max(u.vel.y, kb * 0.6);
      u.stun = Math.max(u.stun, Math.min(1.2, kb * 0.08));
      u.onGround = false;
    }
    this.emit({ kind: 'unit_hit', id: u.id, damage: amount, killed, dir });
    if (source === null) {
      this.grudge[u.team] = OW_TOWN_PLAYER_GRUDGE;
      if (u.state !== 'fight' || u.target !== 'player') {
        this.engage(u, 'player');
        this.rally(u, 'player');
      }
    } else if (source !== 'blast' && source.unit && source.team !== u.team) {
      if (!killed && (u.state !== 'fight' || !this.targetAlive(u.target))) {
        this.engage(u, source.unit);
        this.rally(u, source.unit);
      }
    }
    if (killed) this.kill(u, source);
  }

  private kill(u: TownUnit, source: { team: Team; unit: TownUnit | null } | null | 'blast'): void {
    u.state = 'dead';
    u.hp = 0;
    u.timer = OW_TOWN_CORPSE_TIME;
    u.target = null;
    this.emit({ kind: 'unit_die', id: u.id, pos: { ...u.pos }, team: u.team });
    if (source && source !== 'blast') {
      this.kills[source.team]++;
      const t = Math.min(1, this.tension[source.team][u.team] + OW_TOWN_TENSION_KILL);
      this.tension[source.team][u.team] = this.tension[u.team][source.team] = t;
    }
    // 大物が倒れたら知らせる
    if (u.type.cost >= 600) this.news(`${TEAM_NAMES[u.team]}の${u.type.name}が倒れた！`, 'info');
    this.respawnQueue[u.team].push(OW_TOWN_RESPAWN + this.rng() * 6);
  }

  private moveToward(u: TownUnit, goal: { x: number; z: number } | null, speed: number, dt: number): void {
    let wx = 0;
    let wz = 0;
    if (goal) {
      const dx = goal.x - u.pos.x;
      const dz = goal.z - u.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.05) {
        wx = dx / d;
        wz = dz / d;
        u.yaw = Math.atan2(dx, dz);
      }
    }
    const accel = u.onGround ? 10 : 2;
    u.vel.x += (wx * speed - u.vel.x) * Math.min(1, accel * dt);
    u.vel.z += (wz * speed - u.vel.z) * Math.min(1, accel * dt);
    u.vel.y -= OW_GRAVITY * dt;
    // 大きな兵は、戦いの最中なら前の建物を押し壊す
    if (goal && u.scale >= OW_TOWN_CRUSH_SCALE && u.state !== 'life') this.crushAhead(u, wx, wz);
    const bx = u.pos.x;
    const bz = u.pos.z;
    u.onGround = this.host.moveTownBox(u.pos, u.vel, u.half, u.height, dt, u.onGround);
    const moved = Math.hypot(u.pos.x - bx, u.pos.z - bz);
    u.moveSpeed = moved / dt;
    if (goal && speed > 0 && moved < speed * dt * 0.25) {
      u.stuck += dt;
      if (u.stuck > 1) {
        u.stuck = 0;
        // 引っかかったら近くの歩道の交点へ回り道する
        this.snapToNode(u);
        const [da, db] = DIRS[Math.floor(this.rng() * 4)];
        const a = Math.max(0, Math.min(SIDEWALK_LINES.length - 1, u.nodeA + da));
        const b = Math.max(0, Math.min(SIDEWALK_LINES.length - 1, u.nodeB + db));
        u.detour = { x: SIDEWALK_LINES[a], z: SIDEWALK_LINES[b] };
        if (u.state === 'life' || u.state === 'march') {
          u.nodeA = a;
          u.nodeB = b;
          u.detour = null;
        }
      }
    } else u.stuck = Math.max(0, u.stuck - dt);
  }

  /** 進む先にあるブロックを壊す（1 ステップに数個まで） */
  private crushAhead(u: TownUnit, wx: number, wz: number): void {
    const w = this.host.world;
    const ahead = u.half + 0.4;
    const cx = u.pos.x + wx * ahead;
    const cz = u.pos.z + wz * ahead;
    const broken: [number, number, number][] = [];
    const r = Math.ceil(u.half);
    for (let y = Math.floor(u.pos.y) + 1; y < u.pos.y + u.height && broken.length < 8; y++) {
      for (let dz = -r; dz <= r && broken.length < 8; dz++) {
        for (let dx = -r; dx <= r && broken.length < 8; dx++) {
          const x = Math.floor(cx + dx);
          const z = Math.floor(cz + dz);
          if (!w.solidAt(x, y, z) || w.hardnessAt(x, y, z) === 0) continue;
          if (this.host.destruction.breakBlock(x, y, z, { debris: 1, check: false, push: { x: wx * 4, y: 1, z: wz * 4 } })) broken.push([x, y, z]);
        }
      }
    }
    if (broken.length > 0) this.host.destruction.checkSupport(broken);
  }

  /** 兵どうしが重ならないよう押し離す */
  private separate(): void {
    const us = this.units;
    for (let i = 0; i < us.length; i++) {
      const a = us[i];
      if (a.state === 'dead') continue;
      for (let j = i + 1; j < us.length; j++) {
        const b = us[j];
        if (b.state === 'dead') continue;
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const min = (a.half + b.half) * 1.3 + 0.2;
        if (Math.abs(dx) > min || Math.abs(dz) > min) continue;
        const d = Math.hypot(dx, dz);
        if (d >= min || d === 0 || Math.abs(a.pos.y - b.pos.y) > 2) continue;
        const push = (min - d) * 0.5;
        const ka = b.scale / (a.scale + b.scale);
        a.pos.x -= (dx / d) * push * ka;
        a.pos.z -= (dz / d) * push * ka;
        b.pos.x += (dx / d) * push * (1 - ka);
        b.pos.z += (dz / d) * push * (1 - ka);
      }
    }
  }

  private updateShots(dt: number): void {
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      s.time -= dt;
      if (s.time > 0) continue;
      this.shots.splice(i, 1);
      if (s.blast > 0) {
        // 爆発は町も壊す（爆風の当たりは OpenWorldSim.applyBlast がまとめて処理する）
        this.host.destruction.explode(s.to, s.blast, 'town');
        continue;
      }
      if (!this.targetAlive(s.target)) continue;
      const tp = this.targetPos(s.target!);
      const tScale = s.target === 'player' ? 1 : (s.target as TownUnit).scale;
      // 狙った場所から離れていたら外れ
      if (Math.hypot(tp.x - s.to.x, tp.z - s.to.z) > 1.3 * tScale + 0.6) continue;
      const dir = this.norm({ x: s.to.x - s.from.x, y: 0, z: s.to.z - s.from.z });
      const shooter = this.units.find((u) => u.id === s.shooter) ?? null;
      this.hitTarget(s.target!, s.damage, dir, shooter);
    }
  }

  /** 爆風を兵に当てる（OpenWorldSim.applyBlast から呼ぶ） */
  applyBlast(pos: V3, radius: number, byPlayer: boolean): void {
    const reach = radius * 1.8;
    for (const u of this.units) {
      if (u.state === 'dead') continue;
      const d = Math.hypot(u.pos.x - pos.x, u.pos.y + u.height * 0.5 - pos.y, u.pos.z - pos.z) - u.half;
      if (d > reach) continue;
      const k = Math.max(0, 1 - d / reach);
      const dir = this.norm({ x: u.pos.x - pos.x, y: 0, z: u.pos.z - pos.z });
      this.damage(u, 140 * k * (radius / 4), dir, byPlayer ? null : 'blast');
      // damage の中で倒れていることがある
      if ((u.state as TownState) !== 'dead' && k > 0.3) {
        u.vel.y = Math.max(u.vel.y, (6 + 8 * k) / Math.max(1, u.scale));
        u.stun = Math.max(u.stun, 0.6 * k);
        u.onGround = false;
      }
    }
  }

  /** 光線に当たる最初の兵（ライフルなど）。距離と兵を返す */
  raycastUnits(o: V3, d: V3, maxDist: number): { unit: TownUnit; t: number } | null {
    let best: { unit: TownUnit; t: number } | null = null;
    for (const u of this.units) {
      if (u.state === 'dead') continue;
      const c = { x: u.pos.x, y: u.pos.y + u.height * 0.5, z: u.pos.z };
      const r = Math.max(0.45, u.half * 1.5, u.height * 0.35);
      const ox = o.x - c.x;
      const oy = o.y - c.y;
      const oz = o.z - c.z;
      const b = ox * d.x + oy * d.y + oz * d.z;
      const cc = ox * ox + oy * oy + oz * oz - r * r;
      const disc = b * b - cc;
      if (disc < 0) continue;
      const t = -b - Math.sqrt(disc);
      if (t < 0 || t > maxDist) continue;
      if (!best || t < best.t) best = { unit: u, t };
    }
    return best;
  }

  /** 倒れた体はしばらくして砕け散る */
  private updateCorpses(dt: number): void {
    for (let i = this.units.length - 1; i >= 0; i--) {
      const u = this.units[i];
      if (u.state !== 'dead') continue;
      u.timer -= dt;
      if (u.timer > 0) continue;
      this.units.splice(i, 1);
      this.burst(u);
    }
  }

  /** 体を陣営の色のブロックにして飛び散らせる */
  private burst(u: TownUnit): void {
    const pal = TEAM_COLORS[u.team];
    const colors = [pal.shirt, pal.pants, pal.accent, u.type.look.skin];
    const n = Math.min(60, Math.round(14 * u.scale * u.scale));
    for (let k = 0; k < n; k++) {
      this.host.destruction.spawnDebris(
        u.pos.x + (this.rng() - 0.5) * u.half * 2,
        u.pos.y + this.rng() * u.height * 0.5 + 0.2,
        u.pos.z + (this.rng() - 0.5) * u.half * 2,
        (this.rng() - 0.5) * 5,
        2 + this.rng() * 4,
        (this.rng() - 0.5) * 5,
        colors[Math.floor(this.rng() * colors.length)],
        0.12 + this.rng() * 0.12 * u.scale,
      );
    }
    this.emit({ kind: 'unit_burst', id: u.id, pos: { ...u.pos } });
  }

  private updateRespawn(dt: number): void {
    for (let t = 0; t < OW_TOWN_FACTIONS; t++) {
      const q = this.respawnQueue[t];
      for (let k = q.length - 1; k >= 0; k--) {
        q[k] -= dt;
        if (q[k] > 0) continue;
        q.splice(k, 1);
        if (this.alive(t as Team).length >= OW_TOWN_POP + 2) continue;
        const u = this.spawn(t as Team, this.pickType());
        if (u.type.cost >= 800) this.news(`${TEAM_NAMES[t]}に${u.type.name}が加わった`, 'info');
      }
    }
  }

  /** 陣営の様子（HUD 用） */
  factionSummary(team: Team): { alive: number; status: string } {
    const alive = this.alive(team).length;
    const war = this.wars.find((w) => w.attacker === team || w.defender === team);
    if (war) {
      const other = war.attacker === team ? war.defender : war.attacker;
      return { alive, status: `${war.attacker === team ? '侵攻中' : '防衛中'}→${TEAM_NAMES[other].slice(0, 1)}` };
    }
    if (this.units.some((u) => u.team === team && u.state === 'fight')) return { alive, status: '交戦中' };
    let maxT = 0;
    for (let o = 0; o < OW_TOWN_FACTIONS; o++) if (o !== team) maxT = Math.max(maxT, this.tension[team][o]);
    return { alive, status: maxT > 0.75 ? '一触即発' : maxT > 0.45 ? '緊張' : '平穏' };
  }
}
