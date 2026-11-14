import type { Routes } from '@angular/router';
import { Home } from './pages/home';
import { Room } from './pages/room';
import { Stats } from './pages/stats';

export const routes: Routes = [
  { path: '', component: Home, title: 'Lunchrad' },
  { path: 'r/:code', component: Room, title: 'Kamer in Lunchrad' },
  { path: 'statistieken', component: Stats, title: 'Eerdere lunches | Lunchrad' },
  {
    path: 'admin',
    loadComponent: () => import('./pages/admin/admin').then((m) => m.Admin),
    title: 'Beheer | Lunchrad',
  },
  { path: '**', redirectTo: '' },
];
