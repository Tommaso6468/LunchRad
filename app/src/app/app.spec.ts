import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [App] }).compileComponents();
  });

  it('renders the Dutch title and tagline', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toBe('Lunchrad');
    expect(el.textContent).toContain('Waar gaan we lunchen?');
  });

  it('marks room-code digits separately from letters', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const digits = [...el.querySelectorAll('.room-code .digit')].map((s) => s.textContent);
    expect(digits).toEqual(['7', '4', '0']);
  });
});
