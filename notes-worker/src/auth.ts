import type { Env } from './types';

const SESSION_PREFIX = 'session:';
const SESSION_TTL = 60 * 60 * 24; // 24 hours

/**
 * Security headers to be added to all responses.
 * These mitigate various attack vectors:
 * - CSP: Prevents inline script execution (XSS mitigation)
 * - X-Content-Type-Options: Prevents MIME sniffing
 * - X-Frame-Options: Prevents clickjacking
 * - Referrer-Policy: Controls information leakage
 */
export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; script-src 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
};

/**
 * Constant-time string comparison to prevent timing attacks.
 * Uses Web Crypto API's timing-safe comparison when available.
 */
export async function secureCompare(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const aBuffer = encoder.encode(a);
  const bBuffer = encoder.encode(b);

  // If lengths differ, still do comparison to maintain constant time
  if (aBuffer.length !== bBuffer.length) {
    // Hash both to ensure constant-time execution
    const aHash = await crypto.subtle.digest('SHA-256', aBuffer);
    const bHash = await crypto.subtle.digest('SHA-256', bBuffer);
    // Compare hashes (will be different) - this is just to consume time
    const aView = new Uint8Array(aHash);
    const bView = new Uint8Array(bHash);
    let result = 0;
    for (let i = 0; i < aView.length; i++) {
      result |= aView[i] ^ bView[i];
    }
    return false; // Always false for different lengths
  }

  // Constant-time XOR comparison
  let result = 0;
  for (let i = 0; i < aBuffer.length; i++) {
    result |= aBuffer[i] ^ bBuffer[i];
  }
  return result === 0;
}

export async function createSession(env: Env): Promise<string> {
  const token = crypto.randomUUID();
  await env.NOTES_KV.put(`${SESSION_PREFIX}${token}`, 'valid', {
    expirationTtl: SESSION_TTL,
  });
  return token;
}

export async function validateSession(env: Env, token: string): Promise<boolean> {
  if (!token) return false;
  const session = await env.NOTES_KV.get(`${SESSION_PREFIX}${token}`);
  return session === 'valid';
}

export async function deleteSession(env: Env, token: string): Promise<void> {
  if (token) {
    await env.NOTES_KV.delete(`${SESSION_PREFIX}${token}`);
  }
}

export function getSessionFromCookie(request: Request): string | null {
  const cookie = request.headers.get('Cookie');
  if (!cookie) return null;
  const match = cookie.match(/session=([^;]+)/);
  return match ? match[1] : null;
}

export function createSessionCookie(token: string): string {
  return `session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL}`;
}

export function createLogoutCookie(): string {
  return 'session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0';
}

export async function requireAuth(request: Request, env: Env): Promise<Response | null> {
  const token = getSessionFromCookie(request);
  if (!token || !(await validateSession(env, token))) {
    return new Response(null, {
      status: 302,
      headers: { Location: '/admin/login' },
    });
  }
  return null; // Authenticated
}
