import { Injectable } from '@angular/core';
import {
  ADMIN_ERRORS,
  adminOverview,
  adminRooms,
  auditPage,
  teamKeyRotated,
  teamKeyStatus,
  type AdminError,
  type AdminOverview,
  type AdminRoom,
  type AuditPage,
  type RestaurantInput,
  type TeamKeyStatus,
} from '@lunchrad/shared';

interface Parser<T> {
  safeParse(data: unknown): { success: true; data: T } | { success: false };
}

/** 'login' means the Cloudflare Access session is missing or has expired. */
export type AdminFailureCode = AdminError | 'network' | 'login';

export class AdminFailure extends Error {
  constructor(readonly code: AdminFailureCode) {
    super(code);
  }
}

function isAdminError(value: unknown): value is AdminError {
  return typeof value === 'string' && (ADMIN_ERRORS as readonly string[]).includes(value);
}

/**
 * The admin API. Cloudflare Access authenticates with its own cookie on this
 * origin, so requests send same-origin credentials, plus the custom header
 * the Worker requires for every change (cross-site forms cannot send it).
 */
@Injectable({ providedIn: 'root' })
export class AdminApi {
  overview(): Promise<AdminOverview> {
    return this.request('GET', '/overview', undefined, adminOverview);
  }

  addRestaurant(input: RestaurantInput): Promise<AdminOverview> {
    return this.request('POST', '/restaurants', input, adminOverview);
  }

  updateRestaurant(id: string, input: RestaurantInput): Promise<AdminOverview> {
    return this.request('PATCH', `/restaurants/${id}`, input, adminOverview);
  }

  deleteRestaurant(id: string): Promise<AdminOverview> {
    return this.request('DELETE', `/restaurants/${id}`, undefined, adminOverview);
  }

  addPreset(name: string): Promise<AdminOverview> {
    return this.request('POST', '/presets', { name }, adminOverview);
  }

  renamePreset(id: string, name: string): Promise<AdminOverview> {
    return this.request('PATCH', `/presets/${id}`, { name }, adminOverview);
  }

  setPresetRestaurants(id: string, restaurantIds: string[]): Promise<AdminOverview> {
    return this.request('PUT', `/presets/${id}/restaurants`, { restaurantIds }, adminOverview);
  }

  makeDefault(id: string): Promise<AdminOverview> {
    return this.request('POST', `/presets/${id}/default`, undefined, adminOverview);
  }

  deletePreset(id: string): Promise<AdminOverview> {
    return this.request('DELETE', `/presets/${id}`, undefined, adminOverview);
  }

  async rooms(): Promise<AdminRoom[]> {
    return (await this.request('GET', '/rooms', undefined, adminRooms)).rooms;
  }

  async closeRoom(code: string): Promise<void> {
    await this.request('POST', `/rooms/${code}/close`, undefined, {
      safeParse: (data: unknown) => ({ success: true as const, data }),
    });
  }

  teamKeyStatus(): Promise<TeamKeyStatus> {
    return this.request('GET', '/team-key', undefined, teamKeyStatus);
  }

  async rotateTeamKey(): Promise<string> {
    return (await this.request('POST', '/team-key/rotate', undefined, teamKeyRotated)).teamKey;
  }

  audit(before: number | null): Promise<AuditPage> {
    const query = before === null ? '' : `?before=${before}`;
    return this.request('GET', `/audit${query}`, undefined, auditPage);
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body: unknown,
    schema: Parser<T>,
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (method !== 'GET') headers['X-Lunchrad-Admin'] = '1';
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let response: Response;
    try {
      response = await fetch(`/admin/api${path}`, {
        method,
        headers,
        body: body === undefined ? null : JSON.stringify(body),
        credentials: 'same-origin',
        cache: 'no-store',
        // An expired Access session answers with a redirect to the login page.
        redirect: 'manual',
      });
    } catch {
      throw new AdminFailure('network');
    }
    if (response.type === 'opaqueredirect' || response.status === 401) {
      throw new AdminFailure('login');
    }

    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = (data as { error?: unknown } | null)?.error;
      throw new AdminFailure(isAdminError(error) ? error : 'server_error');
    }
    const parsed = schema.safeParse(data);
    if (!parsed.success) throw new AdminFailure('server_error');
    return parsed.data;
  }
}
