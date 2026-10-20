import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { nl } from './i18n/nl';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly t = nl;
  // Display-only example; real codes come from the server (M1).
  protected readonly exampleCode = [
    { char: 'K', kind: 'letter' },
    { char: '7', kind: 'digit' },
    { char: 'Q', kind: 'letter' },
    { char: '4', kind: 'digit' },
    { char: 'M', kind: 'letter' },
    { char: '0', kind: 'digit' },
  ] as const;
}
