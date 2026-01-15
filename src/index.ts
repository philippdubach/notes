import type { Env } from './types';
import {
  getNote,
  getLatestNote,
  getPreviousNoteId,
  saveNote,
  deleteNote,
  getAllNotes,
  generateNoteId,
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
} from './auth';
import {
  renderNotePage,
  renderEmptyPage,
  render404Page,
  renderLoginPage,
  renderAdminDashboard,
  renderNoteEditor,
  renderDeleteConfirm,
} from './templates';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Public routes
    if (path === '/' || path === '') {
      return handleHome(env);
    }

    // Admin routes - check BEFORE note page to prevent /admin matching as a note ID
    if (path.startsWith('/admin')) {
      return handleAdminRoutes(request, env, path);
    }

    // Note page: supports both legacy /0001 format and new /V1StGXR8 format
    const noteMatch = path.match(/^\/([a-zA-Z0-9_-]+)$/);
    if (noteMatch) {
      return handleNotePage(env, noteMatch[1]);
    }

    return secureResponse(render404Page(), { status: 404 });
  },
} satisfies ExportedHandler<Env>;

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

async function handleNotePage(env: Env, id: string): Promise<Response> {
  const note = await getNote(env, id);

  if (!note) {
    return secureResponse(render404Page(), { status: 404 });
  }

  const previousId = await getPreviousNoteId(env, id);
  return secureResponse(renderNotePage(note, previousId));
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
      return secureResponse(renderLoginPage());
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
    const notes = await getAllNotes(env);
    return secureResponse(renderAdminDashboard(notes));
  }

  // New note
  if (path === '/admin/new') {
    if (method === 'GET') {
      return secureResponse(renderNoteEditor());
    }
    if (method === 'POST') {
      return handleCreateNote(request, env);
    }
  }

  // Edit note: /admin/edit/:id (supports both legacy 4-digit IDs and new nanoid format)
  const editMatch = path.match(/^\/admin\/edit\/([a-zA-Z0-9_-]+)$/);
  if (editMatch) {
    const id = editMatch[1];
    if (method === 'GET') {
      const note = await getNote(env, id);
      if (!note) {
        return secureResponse('Note not found', { status: 404 });
      }
      return secureResponse(renderNoteEditor(note));
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
        return secureResponse('Note not found', { status: 404 });
      }
      return secureResponse(renderDeleteConfirm(note));
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
  const formData = await request.formData();
  const password = formData.get('password')?.toString() || '';

  // Use constant-time comparison to prevent timing attacks
  const isValid = await secureCompare(password, env.ADMIN_PASSWORD);
  if (!isValid) {
    return secureResponse(renderLoginPage('Invalid password'), { status: 401 });
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

  if (!title || !content) {
    return secureResponse('Title and content are required', { status: 400 });
  }

  // Use UUID-based ID to prevent race conditions
  const id = await generateNoteId();
  await saveNote(env, id, title, content);

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

  await saveNote(env, id, title, content);

  return secureResponse(null, {
    status: 302,
    headers: { Location: '/admin' },
  });
}
