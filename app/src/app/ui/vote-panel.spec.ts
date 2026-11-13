import { TestBed } from '@angular/core/testing';
import type { VoteView } from '@lunchrad/shared';
import { VotePanel } from './vote-panel';

const SANNE = 'a'.repeat(16);
const TOM = 'b'.repeat(16);
const LATE = 'c'.repeat(16);

const vote: VoteView = {
  eligible: [SANNE, TOM],
  yes: [TOM],
  no: [],
  durationMs: 30_000,
  remainingMs: 12_400,
};

async function render(you: string) {
  const fixture = TestBed.createComponent(VotePanel);
  fixture.componentRef.setInput('vote', vote);
  fixture.componentRef.setInput('you', you);
  fixture.componentRef.setInput('respinsLeft', 1);
  await fixture.whenStable();
  return { el: fixture.nativeElement as HTMLElement, fixture };
}

describe('VotePanel', () => {
  it('shows the time the server reported and how many yes votes are needed', async () => {
    const { el } = await render(SANNE);
    expect(el.textContent).toContain('Nog 13 seconden');
    expect(el.textContent).toContain('1 van de 2 ja-stemmen');
    expect(el.querySelector('[role="progressbar"]')?.getAttribute('aria-valuemax')).toBe('30');
  });

  it('marks your own vote as pressed', async () => {
    const { el } = await render(TOM);
    const pressed = [...el.querySelectorAll('button')].map((b) => b.getAttribute('aria-pressed'));
    expect(pressed).toEqual(['true', 'false']);
  });

  it('emits the choice', async () => {
    const { el, fixture } = await render(SANNE);
    const choices: string[] = [];
    fixture.componentInstance.voted.subscribe((c) => choices.push(c));
    el.querySelectorAll('button')[1]?.click();
    expect(choices).toEqual(['no']);
  });

  it('tells late joiners they do not vote, without buttons', async () => {
    const { el } = await render(LATE);
    expect(el.querySelectorAll('button')).toHaveLength(0);
    expect(el.textContent).toContain('stemt deze keer niet mee');
  });

  it('warns when this is the last respin', async () => {
    const { el } = await render(SANNE);
    expect(el.textContent).toContain('laatste keer');
  });
});
