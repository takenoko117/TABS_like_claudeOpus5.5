/** 初回プレイの案内ステップ。イベントが起きると次のステップへ進む */
export type TutorialEvent = 'placed' | 'battle_started' | 'battle_ended';

export interface TutorialStep {
  id: string;
  text: string;
  /** 強調表示する要素の id */
  highlightId: string | null;
  /** このイベントで次のステップへ進む */
  advanceOn: TutorialEvent;
}

const STORAGE_KEY = 'tabs_voxel_tutorial_done_v1';

export function buildTutorialSteps(isTouch: boolean): TutorialStep[] {
  const tap = isTouch ? 'タップ' : 'クリック';
  return [
    {
      id: 'place',
      text: isTouch
        ? '① 下のカードで兵種を選び、赤枠の中をタップして配置しよう'
        : '① 下のカードで兵種を選び、赤枠の中をクリックして配置しよう（ドラッグで連続配置）',
      highlightId: 'unit-bar',
      advanceOn: 'placed',
    },
    {
      id: 'start',
      text: isTouch
        ? '② 予算の範囲で置けたら「⚔ 戦闘開始」！ 「↶ 戻す」で取り消せます'
        : '② 予算の範囲で置けたら「⚔ 戦闘開始」！ Ctrl+Z で取り消し、右クリックで削除できます',
      highlightId: 'btn-start',
      advanceOn: 'battle_started',
    },
    {
      id: 'watch',
      text: `③ あとは見守るだけ。ユニットを${tap}するとカメラで追跡、上のボタンで倍速にできます`,
      highlightId: 'battle-speed-bar',
      advanceOn: 'battle_ended',
    },
  ];
}

/** 案内の進行を管理する。表示そのものは onChange 側に任せる */
export class TutorialGuide {
  private index = -1;

  constructor(
    private readonly steps: readonly TutorialStep[],
    private readonly onChange: (step: TutorialStep | null) => void,
    private readonly markDone: () => void,
  ) {}

  get current(): TutorialStep | null {
    return this.steps[this.index] ?? null;
  }

  start(): void {
    this.index = 0;
    this.onChange(this.current);
  }

  notify(event: TutorialEvent): void {
    const step = this.current;
    if (!step || step.advanceOn !== event) return;
    this.index++;
    if (this.current) {
      this.onChange(this.current);
    } else {
      this.finish();
    }
  }

  /** 最後まで進めるか「閉じる」で終了し、次回以降は表示しない */
  finish(): void {
    this.index = this.steps.length;
    this.markDone();
    this.onChange(null);
  }
}

export function isTutorialDone(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return true;
  }
}

export function markTutorialDone(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // 保存できない環境では次回も案内する
  }
}
