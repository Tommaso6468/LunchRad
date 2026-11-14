import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { apply } from './app/core/theme';

// A chosen light or dark theme applies before the first render.
apply();

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
