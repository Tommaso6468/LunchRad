import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import { appConfig } from './app.config';
import { RoomCode } from './ui/room-code';

describe('Home', () => {
  beforeEach(() => {
    localStorage.clear();
    // The real app providers, so tests see the same router setup as production.
    TestBed.configureTestingModule({ providers: appConfig.providers });
  });

  it('asks for the team code before anything else', async () => {
    const harness = await RouterTestingHarness.create('/');
    const el = harness.routeNativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toBe('Lunchrad');
    expect(el.querySelector('#team-key')).toBeTruthy();
    expect(el.querySelector('#join-code')).toBeNull();
  });

  it('shows join and create once a team session exists', async () => {
    localStorage.setItem(
      'lunchrad.team',
      JSON.stringify({ token: 'x.y', expiresAt: Date.now() + 60_000 }),
    );
    const harness = await RouterTestingHarness.create('/');
    const el = harness.routeNativeElement as HTMLElement;
    expect(el.querySelector('#join-code')).toBeTruthy();
    expect(el.querySelector('#create-name')).toBeTruthy();
  });

  it('prefills the last used name', async () => {
    localStorage.setItem(
      'lunchrad.team',
      JSON.stringify({ token: 'x.y', expiresAt: Date.now() + 60_000 }),
    );
    localStorage.setItem('lunchrad.name', JSON.stringify('Sanne'));
    const harness = await RouterTestingHarness.create('/');
    const input = (harness.routeNativeElement as HTMLElement).querySelector<HTMLInputElement>(
      '#join-name',
    );
    expect(input?.value).toBe('Sanne');
  });

  it('rejects a malformed room link', async () => {
    const harness = await RouterTestingHarness.create('/r/<script>');
    expect((harness.routeNativeElement as HTMLElement).textContent).toContain(
      'Een kamercode heeft 6 letters en cijfers.',
    );
  });
});

describe('RoomCode', () => {
  it('marks digits separately from letters and is read out per character', async () => {
    const fixture = TestBed.createComponent(RoomCode);
    fixture.componentRef.setInput('code', 'K7Q4M0');
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const digits = [...el.querySelectorAll('.digit')].map((s) => s.textContent);
    expect(digits).toEqual(['7', '4', '0']);
    expect(el.querySelector('.code')?.getAttribute('aria-label')).toBe('K 7 Q 4 M 0');
  });
});
