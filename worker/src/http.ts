import { LIMITS, type ApiError } from '@lunchrad/shared';

const STATUS: Record<ApiError, number> = {
  bad_request: 400,
  unauthorized: 401,
  wrong_team_key: 401,
  rate_limited: 429,
  bot_check_failed: 403,
  invalid_name: 400,
  name_taken: 409,
  room_full: 409,
  room_not_found: 404,
  not_found: 404,
  not_configured: 503,
  server_error: 500,
};

const NO_STORE = { 'Cache-Control': 'no-store' };

export function apiError(error: ApiError): Response {
  return Response.json({ error }, { status: STATUS[error], headers: NO_STORE });
}

export function apiOk(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

/**
 * Reads a JSON body of at most LIMITS.maxBodyBytes. Returns undefined for a
 * wrong content type, an oversized body or invalid JSON. Streams the body
 * so a lying or missing Content-Length cannot make us buffer more.
 */
export async function readJson(request: Request): Promise<unknown> {
  const type = request.headers.get('Content-Type') ?? '';
  if (!/^application\/json(\s*;|$)/i.test(type)) return undefined;
  const declared = Number(request.headers.get('Content-Length') ?? '0');
  if (declared > LIMITS.maxBodyBytes) return undefined;
  if (!request.body) return undefined;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > LIMITS.maxBodyBytes) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch {
    return undefined;
  }
}

export function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown';
}
