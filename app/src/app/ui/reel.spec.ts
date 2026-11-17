import { TestBed } from '@angular/core/testing';
import type { RoomState, SpinView } from '@lunchrad/shared';
import { markReceived } from '../core/received-at';
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

  it('counts the time since the snapshot arrived, not since it was shown', async () => {
    const fixture = TestBed.createComponent(Reel);
    fixture.componentRef.setInput('names', names);
    fixture.componentRef.setInput('preview', ids);
    const landed: string[] = [];
    fixture.componentInstance.finished.subscribe((id) => landed.push(id));
    // 5 of 8 seconds in when it arrived, but the wheel page opened 4 s later:
    // the spin is over, so it must land straight away instead of 3 s from now.
    const spin = { ...finishedSpin(1), durationMs: 8000, elapsedMs: 5000 };
    markReceived({ spin } as unknown as RoomState, performance.now() - 4000);
    fixture.componentRef.setInput('spin', spin);
    await fixture.whenStable();
    expect(landed).toEqual(['b'.repeat(16)]);
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
