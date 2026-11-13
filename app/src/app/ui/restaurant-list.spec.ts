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
      categories: ['Chinees', 'Noedels'],
      mapsUrl: 'https://maps.app.goo.gl/x',
      addedBy: null,
    },
    { id: PHO, name: 'Pho 99', categories: [], mapsUrl: null, addedBy: TOM },
  ],
  phase: 'lobby',
  respinsLeft: 3,
  vote: null,
  closesInMs: null,
  spin: null,
};

async function render(you: string, isHost: boolean) {
  const fixture = TestBed.createComponent(RestaurantList);
  fixture.componentRef.setInput('state', state);
  fixture.componentRef.setInput('you', you);
  fixture.componentRef.setInput('isHost', isHost);
  await fixture.whenStable();
  return { el: fixture.nativeElement as HTMLElement, fixture };
}

/** Opens a row's details and returns the row element. */
async function expand(view: Awaited<ReturnType<typeof render>>, index: number) {
  const row = view.el.querySelectorAll<HTMLElement>('.restaurants > li')[index];
  row?.querySelector<HTMLButtonElement>('button.what')?.click();
  await view.fixture.whenStable();
  return view.el.querySelectorAll<HTMLElement>('.restaurants > li')[index];
}

describe('RestaurantList', () => {
  it('shows each restaurant’s share of the wheel on one compact line', async () => {
    const { el } = await render(TOM, false);
    const odds = [...el.querySelectorAll('.odds')].map((o) => o.textContent?.trim());
    expect(odds).toEqual(['3/4', '1/4']);
  });

  it('shows every food type as its own tag', async () => {
    const { el } = await render(TOM, false);
    const tags = [...el.querySelectorAll('.r-categories .tag')].map((t) => t.textContent);
    expect(tags).toEqual(['Chinees', 'Noedels']);
  });

  it('marks your own boost as pressed', async () => {
    const { el } = await render(TOM, false);
    const buttons = [...el.querySelectorAll('button.boost')];
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
  });

  it('hides details until the row is tapped, one row at a time', async () => {
    const view = await render(TOM, false);
    expect(view.el.querySelector('.details')).toBeNull();
    const wok = await expand(view, 0);
    expect(wok?.textContent).toContain('Boost van Sanne, Tom');
    expect(wok?.querySelector('button.what')?.getAttribute('aria-expanded')).toBe('true');
    await expand(view, 1);
    expect(view.el.querySelectorAll('.details')).toHaveLength(1);
  });

  it('lets participants remove only their own restaurants, the host all of them', async () => {
    const tom = await render(TOM, false);
    expect((await expand(tom, 0))?.querySelector('.remove')).toBeNull();
    expect((await expand(tom, 1))?.querySelector('.remove')).not.toBeNull();
    const host = await render(SANNE, true);
    expect((await expand(host, 0))?.querySelector('.remove')).not.toBeNull();
  });

  it('locks boosts, removal and adding once the spin has started', async () => {
    const fixture = TestBed.createComponent(RestaurantList);
    fixture.componentRef.setInput('state', state);
    fixture.componentRef.setInput('you', SANNE);
    fixture.componentRef.setInput('isHost', true);
    fixture.componentRef.setInput('locked', true);
    await fixture.whenStable();
    const view = { el: fixture.nativeElement as HTMLElement, fixture };
    expect(
      [...view.el.querySelectorAll<HTMLButtonElement>('button.boost')].every((b) => b.disabled),
    ).toBe(true);
    expect((await expand(view, 0))?.querySelector('.remove')).toBeNull();
    expect(view.el.querySelector('button.add')).toBeNull();
  });

  it('opens Maps links in a new tab without leaking the page', async () => {
    const view = await render(TOM, false);
    const link = (await expand(view, 0))?.querySelector('a[href]');
    expect(link?.getAttribute('href')).toBe('https://maps.app.goo.gl/x');
    expect(link?.getAttribute('rel')).toContain('noopener');
    expect(link?.getAttribute('rel')).toContain('noreferrer');
  });
});
