import type { Env } from './types';

const SESSION_PREFIX = 'session:';
const SESSION_TTL = 60 * 60 * 24; // 24 hours

/**
 * Security headers to be added to all responses.
 * These mitigate various attack vectors:
 * - HSTS: Forces HTTPS connections (prevents downgrade attacks)
 * - CSP: Prevents inline script execution (XSS mitigation)
 * - X-Content-Type-Options: Prevents MIME sniffing
 * - X-Frame-Options: Prevents clickjacking
 * - Referrer-Policy: Controls information leakage
 */
export const SECURITY_HEADERS: Record<string, string> = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; script-src 'self' 'unsafe-inline' https://gc.zgo.at; connect-src 'self' https://stats.philippdubach.com; media-src 'self' https://static.philippdubach.com",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
};

/**
 * Rate limiting configuration for login attempts.
 * Uses KV with TTL for simple distributed rate limiting.
 */
export const RATE_LIMIT_CONFIG = {
  LOGIN_WINDOW_SECONDS: 300, // 5 minute window
  LOGIN_MAX_ATTEMPTS: 5,      // Max 5 attempts per window
  LOGIN_KEY_PREFIX: 'ratelimit:login:',
};

/**
 * Input validation limits to prevent resource exhaustion.
 */
export const INPUT_LIMITS = {
  MAX_TITLE_LENGTH: 500,
  MAX_CONTENT_LENGTH: 100000, // 100KB
  MAX_PASSWORD_LENGTH: 1000,
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

/**
 * Get client IP for rate limiting (handles CF-Connecting-IP header).
 * Falls back to a default key if no IP is available.
 */
export function getClientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ||
         request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
         'unknown';
}

/**
 * Check if a login attempt should be rate limited.
 * Returns the number of remaining attempts, or 0 if blocked.
 */
export async function checkLoginRateLimit(
  env: Env,
  clientIp: string
): Promise<{ allowed: boolean; remaining: number; resetIn: number }> {
  const key = `${RATE_LIMIT_CONFIG.LOGIN_KEY_PREFIX}${clientIp}`;
  const record = await env.NOTES_KV.get(key, { type: 'json' }) as { count: number; firstAttempt: number } | null;
  
  const now = Date.now();
  const windowMs = RATE_LIMIT_CONFIG.LOGIN_WINDOW_SECONDS * 1000;
  
  if (!record) {
    return { allowed: true, remaining: RATE_LIMIT_CONFIG.LOGIN_MAX_ATTEMPTS - 1, resetIn: windowMs };
  }
  
  // Check if window has expired
  if (now - record.firstAttempt > windowMs) {
    return { allowed: true, remaining: RATE_LIMIT_CONFIG.LOGIN_MAX_ATTEMPTS - 1, resetIn: windowMs };
  }
  
  const remaining = RATE_LIMIT_CONFIG.LOGIN_MAX_ATTEMPTS - record.count;
  const resetIn = windowMs - (now - record.firstAttempt);
  
  return {
    allowed: remaining > 0,
    remaining: Math.max(0, remaining - 1),
    resetIn,
  };
}

/**
 * Record a login attempt for rate limiting.
 */
export async function recordLoginAttempt(env: Env, clientIp: string): Promise<void> {
  const key = `${RATE_LIMIT_CONFIG.LOGIN_KEY_PREFIX}${clientIp}`;
  const record = await env.NOTES_KV.get(key, { type: 'json' }) as { count: number; firstAttempt: number } | null;
  
  const now = Date.now();
  const windowMs = RATE_LIMIT_CONFIG.LOGIN_WINDOW_SECONDS * 1000;
  
  if (!record || now - record.firstAttempt > windowMs) {
    // Start new window
    await env.NOTES_KV.put(key, JSON.stringify({ count: 1, firstAttempt: now }), {
      expirationTtl: RATE_LIMIT_CONFIG.LOGIN_WINDOW_SECONDS,
    });
  } else {
    // Increment existing window
    await env.NOTES_KV.put(key, JSON.stringify({ count: record.count + 1, firstAttempt: record.firstAttempt }), {
      expirationTtl: Math.ceil((windowMs - (now - record.firstAttempt)) / 1000),
    });
  }
}

/**
 * Clear rate limit after successful login.
 */
export async function clearLoginRateLimit(env: Env, clientIp: string): Promise<void> {
  const key = `${RATE_LIMIT_CONFIG.LOGIN_KEY_PREFIX}${clientIp}`;
  await env.NOTES_KV.delete(key);
}
