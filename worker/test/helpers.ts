import { serverMessage, type ServerMessage } from '@lunchrad/shared';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env as testEnv } from 'cloudflare:workers';
import { vi } from 'vitest';
import worker, { type Env } from '../src/index.ts';

export const ORIGIN = 'https://lunchrad.test';

export const SHELL_HTML = `<!doctype html><html lang="nl"><head>
<link rel="stylesheet" href="styles-ABC.css"></head>
<body><app-root></app-root><script src="main-XYZ.js" type="module"></script></body></html>`;

export function makeEnv(overrides: Partial<Env> = {}, assetStatus = 200): Env {
  return {
    ...(testEnv as unknown as Env),
    ASSETS: {
      fetch: async () =>
        new Response(assetStatus === 200 ? SHELL_HTML : 'missing', {
          status: assetStatus,
          headers: { 'Content-Type': 'text/html' },
        }),
      connect: () => {
        throw new Error('not used');
      },
    } as unknown as Fetcher,
    ...overrides,
  };
}

let ipCounter = 0;
/** A fresh fake client IP, so rate limits from one test do not leak into another. */
export function freshIp(): string {
  ipCounter += 1;
  return `198.51.100.${ipCounter % 250}`;
}

export async function call(
  path: string,
  init: RequestInit & { ip?: string } = {},
  env: Env = makeEnv(),
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('CF-Connecting-IP', init.ip ?? freshIp());
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request(`${ORIGIN}${path}`, { ...init, headers }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

export function jsonInit(body: unknown, init: RequestInit & { ip?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  return { method: 'POST', ...init, headers, body: JSON.stringify(body) };
}

/** Makes Turnstile's siteverify answer with the given result. */
export function mockTurnstile(result: Record<string, unknown> = { success: true }) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith('https://challenges.cloudflare.com/')) return Response.json(result);
    throw new Error(`Unexpected outbound fetch in test: ${url}`);
  });
}

export async function teamToken(): Promise<string> {
  const res = await call('/api/session', jsonInit({ teamKey: 'test-team-key' }));
  const body = (await res.json()) as { token: string };
  return body.token;
}

export interface Creds {
  code: string;
  participantId: string;
  token: string;
}

export async function createRoom(name = 'Host', token?: string): Promise<Creds> {
  const team = token ?? (await teamToken());
  const res = await call(
    '/api/rooms',
    jsonInit(
      { name, turnstileToken: 'XXXX.DUMMY.TOKEN' },
      { headers: { Authorization: `Bearer ${team}` } },
    ),
  );
  if (res.status !== 201) throw new Error(`create failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as Creds;
}

export async function joinRoom(code: string, name: string, token?: string): Promise<Response> {
  const team = token ?? (await teamToken());
  return call(
    `/api/rooms/${code}/join`,
    jsonInit({ name }, { headers: { Authorization: `Bearer ${team}` } }),
  );
}

export function roomStub(code: string) {
  const e = testEnv as unknown as Env;
  return e.ROOMS.get(e.ROOMS.idFromName(code));
}

export interface TestSocket {
  ws: WebSocket;
  messages: ServerMessage[];
  /** Resolves with the next message of this type (also ones already received but not yet taken). */
  next<T extends ServerMessage['type']>(type: T): Promise<Extract<ServerMessage, { type: T }>>;
  /** Resolves with the next state message for which the predicate holds. */
  stateWhere(
    predicate: (state: Extract<ServerMessage, { type: 'state' }>['state']) => boolean,
  ): Promise<Extract<ServerMessage, { type: 'state' }>['state']>;
  /** Resolves with the next event for which the predicate holds. */
  eventWhere(
    predicate: (event: Extract<ServerMessage, { type: 'event' }>['event']) => boolean,
  ): Promise<Extract<ServerMessage, { type: 'event' }>['event']>;
  send(message: unknown): void;
  closed: Promise<{ code: number; reason: string }>;
}

/**
 * Opens a WebSocket to a room. `team` is the team session offered as a
 * subprotocol: undefined fetches a valid one, null offers none.
 */
export async function openSocket(
  code: string,
  origin: string | null = ORIGIN,
  team: string | null | undefined = undefined,
): Promise<TestSocket> {
  const headers: Record<string, string> = { Upgrade: 'websocket' };
  if (origin) headers['Origin'] = origin;
  const session = team === undefined ? await teamToken() : team;
  if (session !== null) headers['Sec-WebSocket-Protocol'] = `lunchrad.v1, team.${session}`;
  const res = await call(`/api/rooms/${code}/ws`, { headers });
  if (!res.webSocket) throw new Error(`upgrade failed: ${res.status}`);
  const ws = res.webSocket;
  ws.accept();

  const messages: ServerMessage[] = [];
  const taken = new Set<number>();
  const waiters: (() => void)[] = [];
  ws.addEventListener('message', (event) => {
    messages.push(serverMessage.parse(JSON.parse(event.data as string)));
    for (const wake of waiters.splice(0)) wake();
  });
  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    ws.addEventListener('close', (event) => {
      resolve({ code: event.code, reason: event.reason });
      for (const wake of waiters.splice(0)) wake();
    });
  });

  const next = async <T extends ServerMessage['type']>(type: T) => {
    const deadline = Date.now() + 2000;
    for (;;) {
      const index = messages.findIndex((m, i) => m.type === type && !taken.has(i));
      if (index >= 0) {
        taken.add(index);
        return messages[index] as Extract<ServerMessage, { type: T }>;
      }
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${type}`);
      await new Promise<void>((resolve) => {
        waiters.push(resolve);
        setTimeout(resolve, 50);
      });
    }
  };

  const stateWhere: TestSocket['stateWhere'] = async (predicate) => {
    for (;;) {
      const { state } = await next('state');
      if (predicate(state)) return state;
    }
  };

  const eventWhere: TestSocket['eventWhere'] = async (predicate) => {
    for (;;) {
      const { event } = await next('event');
      if (predicate(event)) return event;
    }
  };

  return {
    ws,
    messages,
    next,
    stateWhere,
    eventWhere,
    send: (m) => ws.send(JSON.stringify(m)),
    closed,
  };
}

/** Opens a socket and authenticates it; returns it after the welcome. */
export async function connectAs(creds: Creds): Promise<TestSocket> {
  const socket = await openSocket(creds.code);
  socket.send({ type: 'hello', token: creds.token });
  await socket.next('welcome');
  return socket;
}
