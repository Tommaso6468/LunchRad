import { TestBed } from '@angular/core/testing';
import type { RoomState } from '@lunchrad/shared';
import { RestaurantList } from './restaurant-list';

const SANNE = 'a'.repeat(16);
const TOM = 'b'.repeat(16);
const WOK = 'c'.repeat(16);
const PHO = 'd'.repeat(16);

const state: RoomState = {
  code: 'K7Q4M0',
  hostId: SANNE,
  createdAt: 0,
  expiresAt: 1,
  participants: [
    { id: SANNE, name: 'Sanne', connected: true, joinedAt: 0, boost: WOK },
    { id: TOM, name: 'Tom', connected: true, joinedAt: 1, boost: WOK },
  ],
  restaurants: [
    {
      id: WOK,
      name: 'Wok To Go',
      category: 'Chinees',
      mapsUrl: 'https://maps.app.goo.gl/x',
      addedBy: null,
    },
    { id: PHO, name: 'Pho 99', category: null, mapsUrl: null, addedBy: TOM },
  ],
};

async function render(you: string, isHost: boolean) {
  const fixture = TestBed.createComponent(RestaurantList);
  fixture.componentRef.setInput('state', state);
  fixture.componentRef.setInput('you', you);
  fixture.componentRef.setInput('isHost', isHost);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

describe('RestaurantList', () => {
  it('shows each restaurant’s share of the wheel: one slice plus one per boost', async () => {
    const el = await render(TOM, false);
    const odds = [...el.querySelectorAll('.odds')].map((o) => o.textContent?.trim());
    expect(odds).toEqual(['3/4', '1/4']);
    expect(el.textContent).toContain('Boost van Sanne, Tom');
  });

  it('marks your own boost as pressed', async () => {
    const el = await render(TOM, false);
    const buttons = [...el.querySelectorAll('button.boost')];
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
  });

  it('lets participants remove only their own restaurants, the host all of them', async () => {
    expect((await render(TOM, false)).querySelectorAll('.remove')).toHaveLength(1);
    expect((await render(SANNE, true)).querySelectorAll('.remove')).toHaveLength(2);
  });

  it('opens Maps links in a new tab without leaking the page', async () => {
    const link = (await render(TOM, false)).querySelector('a[href]');
    expect(link?.getAttribute('href')).toBe('https://maps.app.goo.gl/x');
    expect(link?.getAttribute('rel')).toContain('noopener');
    expect(link?.getAttribute('rel')).toContain('noreferrer');
  });
});
