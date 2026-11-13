import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { RoomState } from '@lunchrad/shared';
import { nl } from '../i18n/nl';

@Component({
  selector: 'app-participant-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let s = state();
    <section class="panel" aria-labelledby="people-title">
      <h2 id="people-title">{{ t.participants(s.participants.length) }}</h2>
      <ul class="people">
        @for (p of s.participants; track p.id) {
          <li [class.offline]="!p.connected">
            <span class="person">
              <span class="name">{{ p.name }}</span>
              @if (p.id === s.hostId) {
                <span class="badge host">{{ t.host }}</span>
              }
              @if (p.id === you()) {
                <span class="badge">{{ t.you }}</span>
              }
              @if (!p.connected) {
                <span class="status">{{ t.offline }}</span>
              }
            </span>
            @if (isHost() && p.id !== you()) {
              <span class="actions">
                @if (p.connected) {
                  <button
                    type="button"
                    class="small"
                    [attr.aria-label]="t.makeHost(p.name)"
                    (click)="makeHost.emit(p.id)"
                  >
                    {{ t.makeHostShort }}
                  </button>
                }
                <button
                  type="button"
                  class="small danger"
                  [attr.aria-label]="t.remove(p.name)"
                  (click)="kick.emit({ id: p.id, name: p.name })"
                >
                  {{ t.removeShort }}
                </button>
              </span>
            }
          </li>
        }
      </ul>
    </section>
  `,
})
export class ParticipantList {
  readonly state = input.required<RoomState>();
  readonly you = input.required<string | null>();
  readonly isHost = input.required<boolean>();
  readonly makeHost = output<string>();
  readonly kick = output<{ id: string; name: string }>();
  protected readonly t = nl.room;
}
