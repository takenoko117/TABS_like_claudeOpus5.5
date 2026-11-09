import type { DamageEvent } from '../combat/CombatSystem';
import type { Team, UnitTypeId } from '../units/UnitTypes';

/** 1回の戦闘で、ある陣営が与えたダメージの集計（戦闘後の内訳・成長曲線に使う） */
export class DamageStats {
  total = 0;
  maxHit = 0;
  maxHitBy: UnitTypeId | null = null;
  kills = 0;
  readonly byUnitType = new Map<UnitTypeId, number>();
  /** レリック・シナジーなど、兵種以外の発生源ごとの合計 */
  readonly bySource = new Map<string, number>();

  constructor(readonly team: Team) {}

  /** 戦闘中のダメージを記録する（味方の攻撃だけを数える） */
  record(e: DamageEvent): void {
    if (!e.attacker || e.attacker.team !== this.team || e.victim.team === this.team) return;
    this.total += e.amount;
    if (e.killed) this.kills++;
    const id = e.attacker.type.id;
    this.byUnitType.set(id, (this.byUnitType.get(id) ?? 0) + e.amount);
    if (e.amount > this.maxHit) {
      this.maxHit = e.amount;
      this.maxHitBy = id;
    }
  }

  /** シナジーやレリックが起こしたダメージを発生源の名前で記録する */
  recordSource(source: string, amount: number): void {
    this.bySource.set(source, (this.bySource.get(source) ?? 0) + amount);
  }

  /** 合計の多い順に並べた兵種ごとの内訳 */
  topUnitTypes(limit = 5): Array<[UnitTypeId, number]> {
    return [...this.byUnitType.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  }

  /** 合計の多い順に並べた発生源ごとの内訳 */
  topSources(limit = 5): Array<[string, number]> {
    return [...this.bySource.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  }

  reset(): void {
    this.total = 0;
    this.maxHit = 0;
    this.maxHitBy = null;
    this.kills = 0;
    this.byUnitType.clear();
    this.bySource.clear();
  }
}
