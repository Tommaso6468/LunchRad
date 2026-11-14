import { Injectable, inject } from '@angular/core';
import {
  apiErrorBody,
  configResponse,
  presetList,
  roomCredentials,
  sessionResponse,
  type ApiError,
  type PresetSummary,
  type RoomCredentials,
} from '@lunchrad/shared';
import { DeviceStore } from './storage';

/** Just what we need from a Zod schema; avoids costly generic inference on ZodType. */
interface Parser<T> {
  safeParse(data: unknown): { success: true; data: T } | { success: false };
}

export class ApiFailure extends Error {
  constructor(readonly code: ApiError | 'network') {
    super(code);
  }
}

@Injectable({ providedIn: 'root' })
export class Api {
  private readonly storage = inject(DeviceStore);

  async config(): Promise<{ turnstileSiteKey: string }> {
    return this.request('GET', '/api/config', undefined, configResponse, false);
  }

  async startTeamSession(teamKey: string): Promise<void> {
    const session = await this.request('POST', '/api/session', { teamKey }, sessionResponse, false);
    this.storage.saveTeamSession(session);
  }

  createRoom(
    name: string,
    turnstileToken: string,
    presetId: string | null,
  ): Promise<RoomCredentials> {
    const body = presetId ? { name, turnstileToken, presetId } : { name, turnstileToken };
    return this.request('POST', '/api/rooms', body, roomCredentials, true);
  }

  async presets(): Promise<PresetSummary[]> {
    return (await this.request('GET', '/api/presets', undefined, presetList, true)).presets;
  }

  joinRoom(code: string, name: string): Promise<RoomCredentials> {
    return this.request(
      'POST',
      `/api/rooms/${encodeURIComponent(code)}/join`,
      { name },
      roomCredentials,
      true,
    );
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    schema: Parser<T>,
    authenticated: boolean,
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (authenticated) {
      const token = this.storage.teamToken();
      if (!token) throw new ApiFailure('unauthorized');
      headers['Authorization'] = `Bearer ${token}`;
    }

    let response: Response;
    try {
      response = await fetch(path, {
        method,
        headers,
        body: body === undefined ? null : JSON.stringify(body),
        credentials: 'omit',
        cache: 'no-store',
      });
    } catch {
      throw new ApiFailure('network');
    }

    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const parsed = apiErrorBody.safeParse(data);
      const code = parsed.success ? parsed.data.error : 'server_error';
      if (code === 'unauthorized') this.storage.forgetTeamSession();
      throw new ApiFailure(code);
    }
    const parsed = schema.safeParse(data);
    if (!parsed.success) throw new ApiFailure('server_error');
    return parsed.data;
  }
}
