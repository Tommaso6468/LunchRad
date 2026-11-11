import type { Routes } from '@angular/router';

// Room routes (/r/:code) arrive in M1. Unknown paths go back to the start.
export const routes: Routes = [{ path: '**', redirectTo: '' }];
