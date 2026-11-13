import { TestBed } from '@angular/core/testing';
import type { SpinView } from '@lunchrad/shared';
import { Reel } from './reel';

const names = new Map([
  ['a'.repeat(16), 'Dikke Mik'],
  ['b'.repeat(16), 'Bibimbap'],
  ['c'.repeat(16), "Zino's"],
]);
const ids = [...names.keys()];

function finishedSpin(winnerIndex: number): SpinView {
  return {
    number: 1,
    reel: ids,
    winnerIndex,
    winnerId: ids[winnerIndex] as string,
    durationMs: 5000,
    elapsedMs: 5000,
  };
}

describe('Reel', () => {
  it('stops with the server’s winning row in the window', async () => {
    const fixture = TestBed.createComponent(Reel);
    fixture.componentRef.setInput('names', names);
    fixture.componentRef.setInput('preview', ids);
    const landed: string[] = [];
    fixture.componentInstance.finished.subscribe((id) => landed.push(id));
    fixture.componentRef.setInput('spin', finishedSpin(2));
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.row.center')?.textContent?.trim()).toBe("Zino's");
    expect(landed).toEqual(['c'.repeat(16)]);
    expect(el.querySelector('[aria-live]')?.textContent).toBe("Het rad koos Zino's");
  });

  it('only lets the lever be pulled when allowed', async () => {
    const fixture = TestBed.createComponent(Reel);
    fixture.componentRef.setInput('names', names);
    fixture.componentRef.setInput('preview', ids);
    let pulls = 0;
    fixture.componentInstance.leverPulled.subscribe(() => pulls++);
    await fixture.whenStable();
    const lever = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.lever');
    expect(lever?.disabled).toBe(true);
    fixture.componentRef.setInput('canPull', true);
    await fixture.whenStable();
    lever?.click();
    expect(pulls).toBe(1);
  });
});
