import { Vector3 } from 'three';
import type { CosmicEffectEvent, CosmicLobVariant } from '../combat/CosmicSkills';

/**
 * 第8弾ユニットの演出（ボクセル粒子）。SceneView.spawnCombatEffect から呼ばれる。
 * push は SceneView.pushFxParticle（位置・速度・色・大きさ・寿命・重力）。
 */
export type FxPush = (pos: Vector3, vel: Vector3, color: number, size: number, life: number, gravity?: number) => void;

/** 放物線で飛ぶ物の重力（見た目だけ） */
const LOB_GRAVITY = 14;

const LOB_COLORS: Record<CosmicLobVariant, readonly number[]> = {
  takoyaki: [0xc9832e, 0x5c2d0e, 0xfff9db],
  yakisoba: [0xc9832e, 0x6b3e1c, 0x2f9e44, 0xf03e3e],
  star: [0xffd43b, 0xfff3bf, 0x9775fa],
};

/** a→b に粒子を並べて光の線を描く */
function beam(push: FxPush, a: Vector3, b: Vector3, colors: readonly number[], size: number, life: number, step = 0.35): void {
  const d = a.distanceTo(b);
  const n = Math.max(2, Math.min(60, Math.ceil(d / step)));
  for (let i = 0; i <= n; i++) {
    const p = a.clone().lerp(b, i / n);
    const jitter = new Vector3((Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3);
    push(p, jitter, colors[i % colors.length], size, life, 0);
  }
}

function burst(push: FxPush, at: Vector3, count: number, speed: number, colors: readonly number[], size: number, life: number, gravity: number): void {
  for (let i = 0; i < count; i++) {
    const dir = new Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.1, Math.random() - 0.5).normalize();
    push(at.clone(), dir.multiplyScalar(speed * (0.5 + Math.random() * 0.7)), colors[i % colors.length], size, life, gravity);
  }
}

function ring(push: FxPush, at: Vector3, count: number, speed: number, colors: readonly number[], size: number, life: number, inward = false): void {
  for (let i = 0; i < count; i++) {
    const ang = (i / count) * Math.PI * 2;
    const dir = new Vector3(Math.cos(ang), 0.05, Math.sin(ang));
    if (inward) {
      const p = at.clone().addScaledVector(dir, speed * life);
      p.y = Math.max(0.3, at.y);
      push(p, dir.multiplyScalar(-speed), colors[i % colors.length], size, life, 0);
    } else {
      const p = at.clone().addScaledVector(dir, 0.6);
      p.y = Math.max(0.3, p.y);
      push(p, dir.multiplyScalar(speed), colors[i % colors.length], size, life, 0);
    }
  }
}

/** 第8弾の演出なら描いて true を返す */
export function spawnCosmicFx(e: CosmicEffectEvent, push: FxPush): boolean {
  switch (e.kind) {
    case 'octopus_lash': {
      // 8 本の足が伸びて叩く（オレンジの線と墨のしぶき）
      for (const t of e.targets) {
        beam(push, e.pos.clone().setY(e.pos.y + 0.2), t, [0xe8590c, 0xffa94d, 0xffe8cc], 0.18, 0.28, 0.3);
        burst(push, t, 6, 4, [0x212529, 0xe8590c], 0.14, 0.4, 6);
      }
      return true;
    }
    case 'deep_sonar': {
      // マッコウクジラのクリック音波（前へ広がる水色の輪の列）
      const right = new Vector3(-e.forward.z, 0, e.forward.x);
      for (let k = 0; k < 8; k++) {
        const c = e.pos.clone().addScaledVector(e.forward, (k / 8) * e.length);
        for (let i = 0; i < 10; i++) {
          const ang = (i / 10) * Math.PI * 2;
          const p = c.clone().addScaledVector(right, Math.cos(ang) * (0.6 + k * 0.12));
          p.y += Math.sin(ang) * (0.6 + k * 0.12);
          push(p, e.forward.clone().multiplyScalar(6), k % 2 === 0 ? 0x99e9f2 : 0xe3fafc, 0.12, 0.35, 0);
        }
      }
      return true;
    }
    case 'squid_grab': {
      // ダイオウイカの触腕が地面から巻き上がる
      for (let k = 0; k < 6; k++) {
        const ang = (k / 6) * Math.PI * 2;
        for (let i = 0; i < 8; i++) {
          const r = e.radius * (1 - i / 9);
          const p = e.pos.clone().add(new Vector3(Math.cos(ang + i * 0.35) * r, i * 0.35, Math.sin(ang + i * 0.35) * r));
          push(p, new Vector3(0, 1.5, 0), i % 3 === 0 ? 0xff8787 : 0xc92a2a, 0.2, 0.5, 0);
        }
      }
      burst(push, e.pos, 14, 3, [0x212529, 0x343a40], 0.22, 0.7, 2); // 墨
      return true;
    }
    case 'cosmic_lob': {
      // 放物線で飛ぶたこ焼き・焼きそば・星（寿命 = 着弾までの時間）
      const t = Math.max(0.1, e.flight);
      const g = e.variant === 'star' ? 0 : LOB_GRAVITY;
      const vel = new Vector3().subVectors(e.to, e.from).divideScalar(t);
      vel.y += 0.5 * g * t;
      const colors = LOB_COLORS[e.variant];
      const size = e.variant === 'star' ? 0.42 : e.variant === 'takoyaki' ? 0.3 : 0.22;
      push(e.from.clone(), vel.clone(), colors[0], size, t, g);
      // 焼きそばは麺がばらけて飛ぶ、星は尾を引く
      const extra = e.variant === 'yakisoba' ? 6 : e.variant === 'star' ? 5 : 1;
      for (let i = 0; i < extra; i++) {
        const v = vel.clone().add(new Vector3((Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8));
        const from = e.from.clone();
        if (e.variant === 'star') from.addScaledVector(vel, -0.03 * (i + 1));
        push(from, v, colors[(i + 1) % colors.length], size * 0.55, t * (e.variant === 'star' ? 1 - i * 0.06 : 1), g);
      }
      return true;
    }
    case 'cosmic_lob_impact': {
      const colors = LOB_COLORS[e.variant];
      if (e.variant === 'takoyaki') {
        burst(push, e.pos, 16, 5, [0xff922b, 0xc9832e, 0xfff9db, 0xf8f9fa], 0.16, 0.45, 8); // 湯気と生地
      } else if (e.variant === 'yakisoba') {
        burst(push, e.pos, 22, 4.5, colors, 0.15, 0.6, 9); // 麺・キャベツ・紅しょうが
      } else {
        burst(push, e.pos, 20, 9, [0xffd43b, 0xffffff, 0x9775fa, 0x74c0fc], 0.2, 0.55, 5);
        ring(push, e.pos, 14, 6, [0xffd43b, 0xfff3bf], 0.16, 0.35);
      }
      return true;
    }
    case 'earth_gravity': {
      // 重力で引き寄せる青い輪（外から中心へ縮む）
      ring(push, e.pos, 36, e.radius / 0.6, [0x339af0, 0x74c0fc, 0x40c057], 0.18, 0.6, true);
      return true;
    }
    case 'tectonic_burst': {
      // 地殻変動: 岩と溶岩が噴き上がる
      for (let i = 0; i < 30; i++) {
        const ang = Math.random() * Math.PI * 2;
        const r = Math.random() * e.radius;
        const p = e.pos.clone().add(new Vector3(Math.cos(ang) * r, 0.1, Math.sin(ang) * r));
        const col = i % 4 === 0 ? 0xff6b35 : i % 4 === 1 ? 0x2b8a3e : i % 4 === 2 ? 0x8d6e63 : 0x5d4037;
        push(p, new Vector3((Math.random() - 0.5) * 2, 7 + Math.random() * 6, (Math.random() - 0.5) * 2), col, 0.34, 0.9, 14);
      }
      return true;
    }
    case 'big_bang': {
      // ビッグバン: 白い閃光から虹色の光が全方位へ
      burst(push, e.pos, 50, 14, [0xffffff, 0xffd43b, 0xff8787, 0x9775fa, 0x74c0fc, 0x63e6be], 0.3, 0.7, 0);
      ring(push, e.pos, 48, e.radius / 0.5, [0xffffff, 0xe599f7, 0x74c0fc], 0.24, 0.5);
      return true;
    }
    case 'gpu_beam': {
      // 並列演算ビーム（緑）。レイトレーシング時は白く太く光る
      const colors = e.raytrace ? [0xffffff, 0xd8f5a2, 0x76b900] : [0x76b900, 0xa9e34b];
      for (const t of e.targets) {
        beam(push, e.from, t, colors, e.raytrace ? 0.2 : 0.12, e.raytrace ? 0.3 : 0.18, 0.4);
        burst(push, t, e.raytrace ? 10 : 4, 4, colors, 0.12, 0.3, 4);
      }
      return true;
    }
    case 'ufo_beam': {
      // 吸い上げビーム（黄色い光の柱）
      for (let i = 0; i < 26; i++) {
        const p = e.to.clone().lerp(e.from, i / 26);
        p.x += (Math.random() - 0.5) * 1.2;
        p.z += (Math.random() - 0.5) * 1.2;
        push(p, new Vector3(0, 4, 0), i % 2 === 0 ? 0xfff3bf : 0xffe066, 0.22, 0.5, 0);
      }
      return true;
    }
    case 'sword_parry': {
      // 大剣で弾いた火花
      burst(push, e.pos, 10, 6, [0xffffff, 0xffe066, 0xadb5bd], 0.1, 0.25, 6);
      return true;
    }
    default:
      return false;
  }
}
