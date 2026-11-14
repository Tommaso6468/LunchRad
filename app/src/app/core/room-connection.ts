import { computed, signal } from '@angular/core';
import {
  CLOSE_CODES,
  WS_PROTOCOL,
  WS_TEAM_PREFIX,
  serverMessage,
  type ClientMessage,
  type CloseReason,
  type RoomCredentials,
  type RoomEvent,
  type RoomState,
  type SocketError,
} from '@lunchrad/shared';

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'finished';
export type FinishReason = CloseReason | 'kicked' | 'left' | 'gone';

const PING_MS = 25_000;
const MAX_BACKOFF_MS = 10_000;

/**
 * One live connection to a room. Reconnects with backoff when the network
 * drops or the phone wakes up, and asks for a fresh snapshot every time, so
 * the screen never shows stale state. Stops for good when the room is
 * closed, the participant was removed, or the token is no longer valid.
 */
export class RoomConnection {
  readonly state = signal<RoomState | null>(null);
  readonly you = signal<string | null>(null);
  readonly status = signal<ConnectionStatus>('connecting');
  readonly finished = signal<FinishReason | null>(null);
  readonly isHost = computed(() => {
    const state = this.state();
    return state !== null && state.hostId === this.you();
  });

  private socket: WebSocket | null = null;
  private attempts = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private closedReason: CloseReason | null = null;
  private readonly onVisible = () => {
    if (document.visibilityState === 'visible' && this.status() === 'reconnecting') {
      this.attempts = 0;
      this.open();
    }
  };

  constructor(
    private readonly credentials: RoomCredentials,
    private readonly teamToken: () => string | null,
    private readonly onEvent: (event: RoomEvent) => void,
    private readonly onError: (error: SocketError) => void = () => undefined,
    private readonly options: {
      /** A big screen: authenticates with a display token and only watches. */
      display?: boolean;
      /** The host asked for a big-screen link; this is its token. */
      onDisplayLink?: (token: string) => void;
    } = {},
  ) {
    document.addEventListener('visibilitychange', this.onVisible);
    this.open();
  }

  send(message: Exclude<ClientMessage, { type: 'hello' | 'display_hello' | 'ping' }>): void {
    if (this.options.display) return; // A big screen only watches.
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  /** Stops the connection without telling the server anything (leaving the page). */
  dispose(): void {
    document.removeEventListener('visibilitychange', this.onVisible);
    clearTimeout(this.retryTimer);
    clearInterval(this.pingTimer);
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000);
  }

  private open(): void {
    clearTimeout(this.retryTimer);
    const old = this.socket;
    this.socket = null;
    old?.close(1000);

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${location.host}/api/rooms/${encodeURIComponent(this.credentials.code)}/ws`;
    const team = this.teamToken();
    if (!team) {
      // Team session expired or was revoked; the room cannot be reached.
      this.finish('gone');
      return;
    }
    const socket = new WebSocket(url, [WS_PROTOCOL, `${WS_TEAM_PREFIX}${team}`]);
    this.socket = socket;

    socket.addEventListener('open', () => {
      const type = this.options.display ? 'display_hello' : 'hello';
      socket.send(JSON.stringify({ type, token: this.credentials.token }));
    });
    socket.addEventListener('message', (event) => {
      if (socket === this.socket) this.handle(event.data);
    });
    socket.addEventListener('close', (event) => {
      if (socket === this.socket) this.handleClose(event.code);
    });
  }

  private handle(data: unknown): void {
    if (typeof data !== 'string') return;
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      return;
    }
    const parsed = serverMessage.safeParse(json);
    if (!parsed.success) return;
    const message = parsed.data;

    switch (message.type) {
      case 'welcome':
      case 'display_welcome':
        this.attempts = 0;
        this.you.set(message.type === 'welcome' ? message.you : null);
        this.state.set(message.state);
        this.status.set('open');
        clearInterval(this.pingTimer);
        this.pingTimer = setInterval(() => {
          if (this.socket?.readyState === WebSocket.OPEN) {
            this.socket.send('{"type":"ping"}');
          }
        }, PING_MS);
        break;
      case 'state':
        this.state.set(message.state);
        break;
      case 'event':
        this.onEvent(message.event);
        break;
      case 'closed':
        this.closedReason = message.reason;
        break;
      case 'error':
        this.onError(message.error);
        break;
      case 'display_link':
        this.options.onDisplayLink?.(message.token);
        break;
      case 'pong':
        break;
    }
  }

  private handleClose(code: number): void {
    clearInterval(this.pingTimer);
    const final: Partial<Record<number, FinishReason>> = {
      [CLOSE_CODES.roomClosed]: this.closedReason ?? 'ended',
      [CLOSE_CODES.kicked]: 'kicked',
      [CLOSE_CODES.left]: 'left',
      [CLOSE_CODES.unauthorized]: 'gone',
    };
    const reason = final[code];
    if (reason) {
      this.finish(reason);
      return;
    }
    // Network drop, server restart, phone asleep: try again.
    this.status.set('reconnecting');
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.attempts);
    this.attempts += 1;
    this.retryTimer = setTimeout(() => this.open(), delay);
  }

  private finish(reason: FinishReason): void {
    this.socket = null;
    this.status.set('finished');
    this.finished.set(reason);
    document.removeEventListener('visibilitychange', this.onVisible);
  }
}
