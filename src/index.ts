import type { Env, Note } from './types';
import {
  getNote,
  getLatestNote,
  getPreviousNoteId,
  saveNote,
  deleteNote,
  getAllNotes,
  generateNoteId,
  getDraft,
  saveDraft,
  deleteDraft,
  getAllDrafts,
  generateDraftId,
  parseZurichToUTC,
} from './db';
import {
  requireAuth,
  createSession,
  createSessionCookie,
  createLogoutCookie,
  getSessionFromCookie,
  deleteSession,
  secureCompare,
  SECURITY_HEADERS,
  INPUT_LIMITS,
  getClientIp,
  checkLoginRateLimit,
  recordLoginAttempt,
  clearLoginRateLimit,
} from './auth';
import {
  renderNotePage,
  renderEmptyPage,
  render404Page,
  renderLoginPage,
  renderAdminDashboard,
  renderNoteEditor,
  renderDeleteConfirm,
  renderDraftEditor,
  renderDraftDeleteConfirm,
  generateRssFeed,
  RSS_XSL_STYLESHEET,
  renderIndexPage,
} from './templates';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Public routes
    if (path === '/' || path === '') {
      return handleHome(env);
    }

    // RSS feed
    if (path === '/feed.xml' || path === '/feed') {
      return handleRssFeed(env);
    }

    // XSL stylesheet for RSS
    if (path === '/feed.xsl') {
      return handleRssStylesheet();
    }

    // robots.txt for search engines
    if (path === '/robots.txt') {
      return handleRobotsTxt();
    }

    // llms.txt for AI agents
    if (path === '/llms.txt') {
      return handleLlmsTxt();
    }

    // sitemap.xml for search engines
    if (path === '/sitemap.xml') {
      return handleSitemap(env);
    }

    // Index/archive page
    if (path === '/all') {
      return handleIndexPage(env);
    }

    // Admin routes - check BEFORE note page to prevent /admin matching as a note ID
    if (path.startsWith('/admin')) {
      return handleAdminRoutes(request, env, path);
    }

    // Plain text version: /note-id.txt
    const txtMatch = path.match(/^\/([a-zA-Z0-9_-]+)\.txt$/);
    if (txtMatch) {
      return handleNotePagePlainText(env, txtMatch[1]);
    }

    // Note page: supports both legacy /0001 format and new /V1StGXR8 format
    const noteMatch = path.match(/^\/([a-zA-Z0-9_-]+)$/);
    if (noteMatch) {
      return handleNotePage(env, noteMatch[1]);
    }

    return secureResponse(render404Page(), { status: 404 });
  },

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<void> {
    await publishScheduledDrafts(env);
  },
} satisfies ExportedHandler<Env>;

/**
 * Publish all drafts that are past their scheduled time
 */
async function publishScheduledDrafts(env: Env): Promise<void> {
  const now = Date.now();
  const drafts = await getAllDrafts(env);

  for (const draftMeta of drafts) {
    if (draftMeta.scheduledFor && draftMeta.scheduledFor <= now) {
      const draft = await getDraft(env, draftMeta.id);
      if (draft) {
        const noteId = await generateNoteId(env);
        await saveNote(env, noteId, draft.title, draft.content);
        await deleteDraft(env, draftMeta.id);
        console.log(`Published scheduled draft ${draftMeta.id} as note ${noteId}`);
      }
    }
  }
}

/**
 * Helper to create a response with security headers
 */
function secureResponse(
  body: string | null,
  init: ResponseInit = {}
): Response {
  const headers = new Headers(init.headers);

  // Add security headers
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(key, value);
  }

  // Set content type if not already set and body is present
  if (body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'text/html; charset=utf-8');
  }

  return new Response(body, { ...init, headers });
}

/**
 * Helper for cacheable public responses (note pages, index, RSS)
 * Uses stale-while-revalidate for optimal performance
 */
function cacheableResponse(
  body: string,
  init: ResponseInit = {},
  maxAge = 300 // 5 minutes default
): Response {
  const headers = new Headers(init.headers);

  // Add security headers
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(key, value);
  }

  // Cache for CDN and browsers with stale-while-revalidate
  headers.set('Cache-Control', `public, max-age=${maxAge}, stale-while-revalidate=60`);

  // Set content type if not already set
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'text/html; charset=utf-8');
  }

  return new Response(body, { ...init, headers });
}

/**
 * Helper for admin responses - no caching to ensure fresh data
 */
function adminResponse(
  body: string,
  init: ResponseInit = {}
): Response {
  const headers = new Headers(init.headers);
  
  // Add security headers
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(key, value);
  }
  
  // Prevent caching for admin pages
  headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  headers.set('Pragma', 'no-cache');
  headers.set('Expires', '0');
  headers.set('Content-Type', 'text/html; charset=utf-8');
  
  return new Response(body, { ...init, headers });
}

async function handleHome(env: Env): Promise<Response> {
  const latestNote = await getLatestNote(env);

  if (!latestNote) {
    return secureResponse(renderEmptyPage());
  }

  // Redirect to latest note
  return secureResponse(null, {
    status: 302,
    headers: { Location: `/${latestNote.id}` },
  });
}

async function handleRssFeed(env: Env): Promise<Response> {
  const notes = await getAllNotes(env);
  const recentNotes = notes.slice(0, 20);

  // Use Promise.allSettled for graceful degradation - if one note fails, others still load
  const results = await Promise.allSettled(
    recentNotes.map(meta => getNote(env, meta.id))
  );
  const fullNotes = results
    .filter((r): r is PromiseFulfilledResult<Note | null> => r.status === 'fulfilled')
    .map(r => r.value)
    .filter((note): note is Note => note !== null);

  const rss = generateRssFeed(fullNotes);

  return new Response(rss, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=60',
      ...SECURITY_HEADERS,
    },
  });
}

function handleRssStylesheet(): Response {
  return new Response(RSS_XSL_STYLESHEET, {
    headers: {
      'Content-Type': 'application/xsl+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=86400', // 24 hours - static content
      ...SECURITY_HEADERS,
    },
  });
}

function handleRobotsTxt(): Response {
  return new Response(
    `User-agent: *
Allow: /
Disallow: /admin

Sitemap: https://notes.philippdubach.com/sitemap.xml
`,
    {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'public, max-age=86400',
        ...SECURITY_HEADERS,
      },
    }
  );
}

function handleLlmsTxt(): Response {
  return new Response(
    `# notes.philippdubach.com

> Short reflections and observations by Philipp D. Dubach

This site contains personal notes and essays. Each note has a sequential ID (e.g., /0001, /0002).

## Endpoints

- / - Redirects to the latest note
- /all - Index of all notes with titles and excerpts
- /{id} - Individual note (HTML)
- /{id}.txt - Individual note (plain text, preferred for parsing)
- /feed.xml - RSS 2.0 feed with full content

## Usage

For content retrieval, prefer the .txt endpoint for clean parsing.
For structured metadata, use the JSON-LD in HTML pages.
For bulk access, use the RSS feed.

## Author

Philipp D. Dubach
https://philippdubach.com
`,
    {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'public, max-age=86400',
        ...SECURITY_HEADERS,
      },
    }
  );
}

async function handleSitemap(env: Env): Promise<Response> {
  const notes = await getAllNotes(env);
  const urls = notes
    .map(
      (n) => `
  <url>
    <loc>https://notes.philippdubach.com/${n.id}</loc>
    <lastmod>${new Date(n.updated).toISOString().split('T')[0]}</lastmod>
  </url>`
    )
    .join('');

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://notes.philippdubach.com/all</loc>
  </url>${urls}
</urlset>`,
    {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600', // 1 hour
        ...SECURITY_HEADERS,
      },
    }
  );
}

async function handleIndexPage(env: Env): Promise<Response> {
  // Uses excerpts from metadata - no need to fetch full notes (N+1 fix)
  const notesMeta = await getAllNotes(env);
  return cacheableResponse(
    renderIndexPage(notesMeta),
    {},
    300 // 5 minutes
  );
}

async function handleNotePage(env: Env, id: string): Promise<Response> {
  const note = await getNote(env, id);

  if (!note) {
    return secureResponse(render404Page(), { status: 404 });
  }

  const [previousId, audioObject] = await Promise.all([
    getPreviousNoteId(env, id),
    env.STATIC_R2.head(`audio/note${id}.mp3`),
  ]);
  const noteHasAudio = audioObject !== null;
  return cacheableResponse(renderNotePage(note, previousId, noteHasAudio), {}, 3600); // 1 hour
}

async function handleNotePagePlainText(env: Env, id: string): Promise<Response> {
  const note = await getNote(env, id);

  if (!note) {
    return plainTextResponse('Note not found.', { status: 404 });
  }

  const titleUnderline = '='.repeat(note.title.length);
  const plainText = `${note.title}
${titleUnderline}

  By Philipp D. Dubach
  https://notes.philippdubach.com/${note.id}
  Note #${note.id}

${note.content}

\u2665
About Notes: https://philippdubach.com/posts/notes-the-space-between/ \u00b7 Get Notes: https://github.com/philippdubach/notes
`;
  return plainTextResponse(plainText);
}

/**
 * Helper to create a plain text response with security headers
 */
function plainTextResponse(
  body: string,
  init: ResponseInit = {}
): Response {
  const headers = new Headers(init.headers);
  
  // Add security headers
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(key, value);
  }
  
  headers.set('Content-Type', 'text/plain; charset=utf-8');
  
  return new Response(body, { ...init, headers });
}

async function handleAdminRoutes(
  request: Request,
  env: Env,
  path: string
): Promise<Response> {
  const method = request.method;

  // Login page (no auth required)
  if (path === '/admin/login') {
    if (method === 'GET') {
      return adminResponse(renderLoginPage());
    }
    if (method === 'POST') {
      return handleLogin(request, env);
    }
  }

  // Logout (no auth check needed)
  if (path === '/admin/logout') {
    const token = getSessionFromCookie(request);
    if (token) {
      await deleteSession(env, token);
    }
    return secureResponse(null, {
      status: 302,
      headers: {
        Location: '/',
        'Set-Cookie': createLogoutCookie(),
      },
    });
  }

  // All other admin routes require authentication
  const authResponse = await requireAuth(request, env);
  if (authResponse) return authResponse;

  // Admin dashboard
  if (path === '/admin' || path === '/admin/') {
    const [notes, drafts] = await Promise.all([getAllNotes(env), getAllDrafts(env)]);
    return adminResponse(renderAdminDashboard(notes, drafts));
  }

  // New note
  if (path === '/admin/new') {
    if (method === 'GET') {
      return adminResponse(renderNoteEditor());
    }
    if (method === 'POST') {
      return handleCreateNote(request, env);
    }
  }

  // Draft routes
  const draftEditMatch = path.match(/^\/admin\/draft\/([a-fA-F0-9]+)$/);
  if (draftEditMatch) {
    const id = draftEditMatch[1];
    if (method === 'GET') {
      const draft = await getDraft(env, id);
      if (!draft) {
        return adminResponse('Draft not found', { status: 404 });
      }
      return adminResponse(renderDraftEditor(draft));
    }
    if (method === 'POST') {
      return handleUpdateDraft(request, env, id);
    }
  }

  const draftDeleteMatch = path.match(/^\/admin\/draft\/([a-fA-F0-9]+)\/delete$/);
  if (draftDeleteMatch) {
    const id = draftDeleteMatch[1];
    if (method === 'GET') {
      const draft = await getDraft(env, id);
      if (!draft) {
        return adminResponse('Draft not found', { status: 404 });
      }
      return adminResponse(renderDraftDeleteConfirm(draft));
    }
    if (method === 'POST') {
      await deleteDraft(env, id);
      return secureResponse(null, {
        status: 302,
        headers: { Location: '/admin' },
      });
    }
  }

  // Edit note: /admin/edit/:id (supports both legacy 4-digit IDs and new nanoid format)
  const editMatch = path.match(/^\/admin\/edit\/([a-zA-Z0-9_-]+)$/);
  if (editMatch) {
    const id = editMatch[1];
    if (method === 'GET') {
      const note = await getNote(env, id);
      if (!note) {
        return adminResponse('Note not found', { status: 404 });
      }
      return adminResponse(renderNoteEditor(note));
    }
    if (method === 'POST') {
      return handleUpdateNote(request, env, id);
    }
  }

  // Delete note: /admin/delete/:id (supports both legacy 4-digit IDs and new nanoid format)
  const deleteMatch = path.match(/^\/admin\/delete\/([a-zA-Z0-9_-]+)$/);
  if (deleteMatch) {
    const id = deleteMatch[1];
    if (method === 'GET') {
      const note = await getNote(env, id);
      if (!note) {
        return adminResponse('Note not found', { status: 404 });
      }
      return adminResponse(renderDeleteConfirm(note));
    }
    if (method === 'POST') {
      await deleteNote(env, id);
      return secureResponse(null, {
        status: 302,
        headers: { Location: '/admin' },
      });
    }
  }

  return secureResponse('Not found', { status: 404 });
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  const clientIp = getClientIp(request);
  
  // Rate limiting check - fail secure (deny on KV failure to prevent brute force)
  try {
    const rateLimit = await checkLoginRateLimit(env, clientIp);
    if (!rateLimit.allowed) {
      const resetMinutes = Math.ceil(rateLimit.resetIn / 60000);
      return secureResponse(
        renderLoginPage(`Too many login attempts. Please try again in ${resetMinutes} minute(s).`),
        {
          status: 429,
          headers: {
            'Retry-After': Math.ceil(rateLimit.resetIn / 1000).toString(),
          },
        }
      );
    }
  } catch (error) {
    // Fail secure: deny login attempts when rate limiting is unavailable
    console.error('Rate limit check failed (denying request):', error instanceof Error ? error.message : 'Unknown error');
    return secureResponse(
      renderLoginPage('Service temporarily unavailable. Please try again later.'),
      { status: 503 }
    );
  }

  const formData = await request.formData();
  const password = formData.get('password')?.toString() || '';
  
  // Input length validation to prevent memory exhaustion
  if (password.length > INPUT_LIMITS.MAX_PASSWORD_LENGTH) {
    return secureResponse(renderLoginPage('Invalid password'), { status: 401 });
  }

  // Use constant-time comparison to prevent timing attacks
  const isValid = await secureCompare(password, env.ADMIN_PASSWORD);
  if (!isValid) {
    // Record failed attempt with fallback
    try {
      await recordLoginAttempt(env, clientIp);
    } catch (error) {
      console.error('Failed to record login attempt:', error instanceof Error ? error.message : 'Unknown error');
    }
    return secureResponse(renderLoginPage('Invalid password'), { status: 401 });
  }

  // Clear rate limit on successful login
  try {
    await clearLoginRateLimit(env, clientIp);
  } catch (error) {
    // Non-critical, just log
    console.error('Failed to clear rate limit:', error instanceof Error ? error.message : 'Unknown error');
  }

  const token = await createSession(env);
  return secureResponse(null, {
    status: 302,
    headers: {
      Location: '/admin',
      'Set-Cookie': createSessionCookie(token),
    },
  });
}

async function handleCreateNote(request: Request, env: Env): Promise<Response> {
  const formData = await request.formData();
  const title = formData.get('title')?.toString() || '';
  const content = formData.get('content')?.toString() || '';
  const action = formData.get('action')?.toString() || 'publish';

  if (!title || !content) {
    return secureResponse('Title and content are required', { status: 400 });
  }

  // Input length validation to prevent resource exhaustion
  if (title.length > INPUT_LIMITS.MAX_TITLE_LENGTH) {
    return secureResponse(`Title must be ${INPUT_LIMITS.MAX_TITLE_LENGTH} characters or less`, { status: 400 });
  }
  if (content.length > INPUT_LIMITS.MAX_CONTENT_LENGTH) {
    return secureResponse(`Content must be ${INPUT_LIMITS.MAX_CONTENT_LENGTH} characters or less`, { status: 400 });
  }

  if (action === 'draft') {
    // Save as draft
    const draftId = generateDraftId();
    await saveDraft(env, draftId, title, content);
  } else {
    // Publish immediately
    const id = await generateNoteId(env);
    await saveNote(env, id, title, content);
  }

  return secureResponse(null, {
    status: 302,
    headers: { Location: '/admin' },
  });
}

async function handleUpdateDraft(
  request: Request,
  env: Env,
  draftId: string
): Promise<Response> {
  const formData = await request.formData();
  const title = formData.get('title')?.toString() || '';
  const content = formData.get('content')?.toString() || '';
  const action = formData.get('action')?.toString() || 'draft';
  const scheduleDateTime = formData.get('scheduleDateTime')?.toString() || '';

  if (!title || !content) {
    return secureResponse('Title and content are required', { status: 400 });
  }

  // Input length validation to prevent resource exhaustion
  if (title.length > INPUT_LIMITS.MAX_TITLE_LENGTH) {
    return secureResponse(`Title must be ${INPUT_LIMITS.MAX_TITLE_LENGTH} characters or less`, { status: 400 });
  }
  if (content.length > INPUT_LIMITS.MAX_CONTENT_LENGTH) {
    return secureResponse(`Content must be ${INPUT_LIMITS.MAX_CONTENT_LENGTH} characters or less`, { status: 400 });
  }

  if (action === 'publish') {
    // Publish the draft: create note with next ID and delete the draft
    const id = await generateNoteId(env);
    await saveNote(env, id, title, content);
    await deleteDraft(env, draftId);
  } else if (action === 'schedule' && scheduleDateTime) {
    // Schedule the draft for future publication
    const scheduledFor = parseZurichToUTC(scheduleDateTime);
    await saveDraft(env, draftId, title, content, scheduledFor);
  } else if (action === 'clearSchedule') {
    // Clear the schedule but keep as draft
    await saveDraft(env, draftId, title, content, null);
  } else {
    // Update the draft (keep existing schedule if any)
    await saveDraft(env, draftId, title, content);
  }

  return secureResponse(null, {
    status: 302,
    headers: { Location: '/admin' },
  });
}

async function handleUpdateNote(
  request: Request,
  env: Env,
  id: string
): Promise<Response> {
  const formData = await request.formData();
  const title = formData.get('title')?.toString() || '';
  const content = formData.get('content')?.toString() || '';

  if (!title || !content) {
    return secureResponse('Title and content are required', { status: 400 });
  }

  // Input length validation to prevent resource exhaustion
  if (title.length > INPUT_LIMITS.MAX_TITLE_LENGTH) {
    return secureResponse(`Title must be ${INPUT_LIMITS.MAX_TITLE_LENGTH} characters or less`, { status: 400 });
  }
  if (content.length > INPUT_LIMITS.MAX_CONTENT_LENGTH) {
    return secureResponse(`Content must be ${INPUT_LIMITS.MAX_CONTENT_LENGTH} characters or less`, { status: 400 });
  }

  await saveNote(env, id, title, content);

  return secureResponse(null, {
    status: 302,
    headers: { Location: '/admin' },
  });
}
