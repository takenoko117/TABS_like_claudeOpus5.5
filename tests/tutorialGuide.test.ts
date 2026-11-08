import { describe, expect, it, vi } from 'vitest';
import { buildTutorialSteps, TutorialGuide, type TutorialStep } from '../src/ui/TutorialGuide';

function createGuide() {
  const shown: Array<TutorialStep | null> = [];
  const markDone = vi.fn();
  const guide = new TutorialGuide(buildTutorialSteps(false), (step) => shown.push(step), markDone);
  return { guide, shown, markDone };
}

describe('初回ガイド', () => {
  it('配置 → 戦闘開始 → 決着の順に進み、完了を記録する', () => {
    const { guide, shown, markDone } = createGuide();
    guide.start();
    expect(guide.current?.id).toBe('place');
    guide.notify('placed');
    expect(guide.current?.id).toBe('start');
    guide.notify('battle_started');
    expect(guide.current?.id).toBe('watch');
    guide.notify('battle_ended');
    expect(guide.current).toBeNull();
    expect(shown.at(-1)).toBeNull();
    expect(markDone).toHaveBeenCalledOnce();
  });

  it('今のステップと関係ないイベントでは進まない', () => {
    const { guide } = createGuide();
    guide.start();
    guide.notify('battle_ended');
    expect(guide.current?.id).toBe('place');
  });

  it('途中で閉じても完了扱いになり、以降のイベントを無視する', () => {
    const { guide, markDone } = createGuide();
    guide.start();
    guide.finish();
    expect(markDone).toHaveBeenCalledOnce();
    guide.notify('placed');
    expect(guide.current).toBeNull();
    expect(markDone).toHaveBeenCalledOnce();
  });

  it('開始前の通知で勝手に進まない', () => {
    const { guide, shown } = createGuide();
    guide.notify('placed');
    expect(shown).toHaveLength(0);
  });
});
