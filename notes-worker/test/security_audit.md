# Security Audit Log - notes.philippdubach.com

**Audit Date:** 2026-01-15  
**Auditor:** Security Assessment (Grey Box)  
**Target:** Cloudflare Workers Notes Application

---

## Phase 1: Reconnaissance & Static Analysis

### 1.1 Architecture Overview

| Component | Technology | Risk Area |
|-----------|------------|-----------|
| Runtime | Cloudflare Workers | Serverless security |
| Database | Cloudflare KV | Data integrity, access control |
| Auth | Cookie-based sessions | Session management |
| Rendering | `marked` v17.0.1 | XSS via Markdown |
| Transport | HTTPS (enforced) | ✅ Good |

### 1.2 Route Map

```
Public Routes:
  GET /          → Redirect to latest note
  GET /:number   → View note (e.g., /0001)

Admin Routes (Protected):
  GET  /admin/login   → Login page (no auth)
  POST /admin/login   → Process login (no auth)
  GET  /admin/logout  → Logout (no auth check)
  GET  /admin         → Dashboard (auth required)
  GET  /admin/new     → New note form (auth required)
  POST /admin/new     → Create note (auth required)
  GET  /admin/edit/:id → Edit form (auth required)
  POST /admin/edit/:id → Update note (auth required)
  GET  /admin/delete/:id → Delete confirm (auth required)
  POST /admin/delete/:id → Delete note (auth required)
```

### 1.3 Configuration Analysis (wrangler.jsonc)

| Setting | Value | Assessment |
|---------|-------|------------|
| `compatibility_date` | 2025-09-27 | ✅ Recent |
| `workers_dev` | false | ✅ Not exposing dev endpoint |
| `compatibility_flags` | `global_fetch_strictly_public` | ✅ Good security practice |
| KV Binding | `NOTES_KV` | ⚠️ ID exposed but low risk |

### 1.4 Dependency Audit

| Package | Version | Vulnerabilities |
|---------|---------|-----------------|
| `marked` | 17.0.1 | ⚠️ No sanitization by default - **XSS RISK** |
| `wrangler` | 4.59.2 | Low - undici decompression (dev only) |

---

## Phase 2: Vulnerability Assessment

### 🔴 CRITICAL: XSS via Markdown Injection

**Location:** [db.ts](../src/db.ts) lines 29-30

**Vulnerable Code:**
```typescript
const htmlContent = await marked.parse(content);
```

**Finding:** The `marked` library does **NOT** sanitize HTML by default. It converts Markdown to HTML but allows arbitrary HTML/JavaScript injection.

**Proof of Concept:**
```markdown
# Test Note
<script>alert(document.cookie)</script>
<img src=x onerror="alert('XSS')">
```

**Impact:** Any admin creating a note (or attacker who gains admin access) can inject JavaScript that executes for ALL visitors. This enables:
- Cookie theft (session hijacking)
- Keylogging
- Defacement
- Phishing attacks

**Severity:** 🔴 CRITICAL

---

### 🟢 PASS: Broken Access Control

**Finding:** All admin routes properly check authentication via `requireAuth()` before processing.

**Evidence:**
- [index.ts](../src/index.ts) line 108: `const authResponse = await requireAuth(request, env);`
- All routes after `/admin/login` and `/admin/logout` call `requireAuth()`
- Login and logout are correctly excluded from auth checks

**Severity:** ✅ PASS

---

### 🟢 PASS: Authentication Cookie Security

**Finding:** Session cookies are properly configured.

**Evidence from [auth.ts](../src/auth.ts) line 32:**
```typescript
return `session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL}`;
```

| Attribute | Present | Purpose |
|-----------|---------|---------|
| `HttpOnly` | ✅ | Prevents JavaScript access |
| `Secure` | ✅ | HTTPS only |
| `SameSite=Strict` | ✅ | CSRF protection |
| `Path=/` | ✅ | Scoped to domain |
| `Max-Age` | ✅ | 24-hour expiry |

**Severity:** ✅ PASS

---

### 🟢 PASS: Session Token Generation

**Finding:** Session tokens use `crypto.randomUUID()` which is cryptographically secure.

**Evidence from [auth.ts](../src/auth.ts) line 7:**
```typescript
const token = crypto.randomUUID();
```

UUID v4 provides 122 bits of randomness - not guessable.

**Severity:** ✅ PASS

---

### 🟡 MEDIUM: Timing Attack on Password Comparison

**Location:** [index.ts](../src/index.ts) line 185

**Vulnerable Code:**
```typescript
if (password !== env.ADMIN_PASSWORD) {
```

**Finding:** String comparison with `!==` is not constant-time. An attacker could theoretically measure response times to extract the password character by character.

**Practical Risk:** LOW - Network latency variance makes this extremely difficult to exploit in practice for a Workers deployment.

**Severity:** 🟡 MEDIUM (theoretical)

---

### 🟡 MEDIUM: Race Condition in Note Counter

**Location:** [db.ts](../src/db.ts) lines 12-17

**Vulnerable Code:**
```typescript
export async function getNextNoteNumber(env: Env): Promise<string> {
  const counter = await env.NOTES_KV.get(COUNTER_KEY);
  const nextNum = counter ? parseInt(counter, 10) + 1 : 1;
  await env.NOTES_KV.put(COUNTER_KEY, nextNum.toString());
  return nextNum.toString().padStart(4, '0');
}
```

**Finding:** This is a classic TOCTOU (Time of Check to Time of Use) race condition. If two admins create notes simultaneously:
1. Admin A reads counter: 5
2. Admin B reads counter: 5
3. Admin A increments to 6, saves note #0006
4. Admin B increments to 6, **overwrites** note #0006

KV is eventually consistent - this WILL cause data loss under concurrent writes.

**Impact:** Data loss / note overwriting

**Severity:** 🟡 MEDIUM

---

### 🟡 MEDIUM: Missing Security Headers

**Finding:** Responses do not include security headers.

**Missing Headers:**
- `Content-Security-Policy` - Would prevent inline script execution (mitigates XSS)
- `X-Content-Type-Options: nosniff` - Prevents MIME sniffing
- `X-Frame-Options: DENY` - Prevents clickjacking
- `Referrer-Policy: strict-origin-when-cross-origin`

**Severity:** 🟡 MEDIUM

---

### 🟢 PASS: IDOR (Insecure Direct Object Reference)

**Finding:** All notes are intentionally public. There is no concept of "draft" or "private" notes in the data model. Sequential IDs (`0001`, `0002`) are by design.

**Note:** If private notes are desired in the future, implement a `published` flag and check it in `handleNotePage()`.

**Severity:** ✅ N/A (by design)

---

### 🟢 PASS: HTML Escaping in Templates

**Finding:** User input is properly escaped in templates.

**Evidence from [templates.ts](../src/templates.ts):**
- Line 73: `${escapeHtml(note.title)}`
- `escapeHtml()` function properly escapes `<`, `>`, `&`, `"`, `'`

**However:** The `note.htmlContent` is rendered unescaped (intentionally for Markdown), which is the XSS vector mentioned above.

**Severity:** ✅ PASS (for user input), 🔴 CRITICAL (for Markdown content)

---

## Phase 2 Summary

| Vulnerability | Severity | Status |
|---------------|----------|--------|
| XSS via Markdown | 🔴 CRITICAL | Requires Fix |
| Broken Access Control | ✅ PASS | - |
| Cookie Security | ✅ PASS | - |
| Session Tokens | ✅ PASS | - |
| Timing Attack | 🟡 MEDIUM | Recommend Fix |
| Race Condition | 🟡 MEDIUM | Recommend Fix |
| Missing Headers | 🟡 MEDIUM | Recommend Fix |
| IDOR | ✅ N/A | By design |

---

## Phase 3: Remediation Plan

### 3.1 XSS Fix (CRITICAL)

**Solution:** Integrate DOMPurify (or isomorphic-dompurify for Workers compatibility) to sanitize HTML output.

```typescript
import DOMPurify from 'isomorphic-dompurify';

const htmlContent = DOMPurify.sanitize(await marked.parse(content));
```

### 3.2 Timing Attack Fix

**Solution:** Use constant-time comparison via Web Crypto API.

```typescript
async function secureCompare(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const aBuffer = encoder.encode(a);
  const bBuffer = encoder.encode(b);
  
  if (aBuffer.length !== bBuffer.length) {
    // Compare against dummy to maintain constant time
    await crypto.subtle.timingSafeEqual?.(aBuffer, aBuffer);
    return false;
  }
  
  return crypto.subtle.timingSafeEqual?.(aBuffer, bBuffer) ?? (a === b);
}
```

### 3.3 Race Condition Fix

**Solution:** Use UUIDs or nanoid for note IDs instead of sequential counter.

```typescript
import { nanoid } from 'nanoid';

export async function generateNoteId(): Promise<string> {
  return nanoid(8); // e.g., "V1StGXR8"
}
```

### 3.4 Security Headers

**Solution:** Add security headers to all responses.

```typescript
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; style-src 'unsafe-inline'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};
```

---

*Audit in progress... See SECURITY_REPORT.md for final report.*
