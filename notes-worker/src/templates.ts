import type { Note, NoteMeta } from './types';

const BASE_STYLES = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #f8f6f1;
    color: #1a1a1a;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 16px;
    line-height: 1.7;
    min-height: 100vh;
  }
  .container {
    max-width: 600px;
    margin: 0 auto;
    padding: 80px 24px;
  }
  a { color: #1a1a1a; }
  a:hover { opacity: 0.7; }
`;

const TITLE_FONT = `font-family: Georgia, 'Times New Roman', serif;`;

function htmlTemplate(title: string, content: string, extraStyles = ''): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>${BASE_STYLES}${extraStyles}</style>
</head>
<body>
  <div class="container">
    ${content}
  </div>
</body>
</html>`;
}

export function renderNotePage(note: Note, previousId: string | null): string {
  const extraStyles = `
    .note-number { font-size: 14px; color: #666; margin-bottom: 8px; }
    .note-title { ${TITLE_FONT} font-size: 32px; font-weight: normal; margin-bottom: 32px; line-height: 1.3; }
    .note-body { margin-bottom: 48px; }
    .note-body p { margin-bottom: 1em; text-align: justify; }
    .note-body h1, .note-body h2, .note-body h3 { ${TITLE_FONT} margin: 1.5em 0 0.5em; font-weight: normal; }
    .note-body h1 { font-size: 1.5em; }
    .note-body h2 { font-size: 1.3em; }
    .note-body h3 { font-size: 1.1em; }
    .note-body ul, .note-body ol { margin: 1em 0 1em 1.5em; }
    .note-body blockquote { border-left: 2px solid #ccc; padding-left: 16px; margin: 1em 0; color: #555; }
    .note-body code { background: #e8e6e1; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
    .note-body pre { background: #e8e6e1; padding: 16px; border-radius: 4px; overflow-x: auto; margin: 1em 0; }
    .note-body pre code { background: none; padding: 0; }
    .note-body a { text-decoration: underline; }
    .nav { text-align: center; font-size: 14px; }
    .nav a { margin: 0 8px; }
  `;

  const navLinks: string[] = [];
  if (previousId) {
    navLinks.push(`<a href="/${previousId}">previous note</a> &gt;`);
  }
  navLinks.push(`<a href="https://philippdubach.com/about">about</a>`);

  const content = `
    <div class="note-number">#${note.id}</div>
    <h1 class="note-title">${escapeHtml(note.title)}</h1>
    <div class="note-body">${note.htmlContent}</div>
    <div class="nav">${navLinks.join('<br><br>')}</div>
  `;

  return htmlTemplate(`#${note.id} – ${note.title}`, content, extraStyles);
}

export function renderEmptyPage(): string {
  const content = `
    <p style="text-align: center; color: #666;">No notes yet.</p>
    <p style="text-align: center; margin-top: 24px;"><a href="https://philippdubach.com/about">about</a></p>
  `;
  return htmlTemplate('Notes', content);
}

export function render404Page(): string {
  const content = `
    <p style="text-align: center; color: #666;">Note not found.</p>
    <p style="text-align: center; margin-top: 24px;"><a href="/">← back to latest</a></p>
  `;
  return htmlTemplate('Not Found', content);
}

// Admin templates
const ADMIN_STYLES = `
  input, textarea, button {
    font-family: inherit;
    font-size: inherit;
  }
  input[type="text"], input[type="password"], textarea {
    width: 100%;
    padding: 12px;
    border: 1px solid #ccc;
    border-radius: 4px;
    background: #fff;
  }
  input[type="text"]:focus, input[type="password"]:focus, textarea:focus {
    outline: none;
    border-color: #666;
  }
  textarea { resize: vertical; min-height: 300px; }
  button {
    padding: 10px 20px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    background: #1a1a1a;
    color: #fff;
  }
  button:hover { background: #333; }
  button.secondary { background: #666; }
  button.danger { background: #c0392b; }
  button.danger:hover { background: #a93226; }
  .form-group { margin-bottom: 20px; }
  label { display: block; margin-bottom: 6px; font-size: 14px; color: #666; }
  .btn-group { display: flex; gap: 10px; }
`;

export function renderLoginPage(error?: string): string {
  const content = `
    <h1 style="${TITLE_FONT} font-size: 24px; margin-bottom: 32px; text-align: center;">Admin Login</h1>
    ${error ? `<p style="color: #c0392b; margin-bottom: 16px; text-align: center;">${escapeHtml(error)}</p>` : ''}
    <form method="POST" action="/admin/login">
      <div class="form-group">
        <label for="password">Password</label>
        <input type="password" id="password" name="password" required autofocus>
      </div>
      <button type="submit" style="width: 100%;">Login</button>
    </form>
    <p style="text-align: center; margin-top: 24px; font-size: 14px;"><a href="/">← back to notes</a></p>
  `;
  return htmlTemplate('Admin Login', content, ADMIN_STYLES);
}

export function renderAdminDashboard(notes: NoteMeta[]): string {
  const extraStyles = ADMIN_STYLES + `
    .note-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 0;
      border-bottom: 1px solid #ddd;
    }
    .note-item:last-child { border-bottom: none; }
    .note-info { flex: 1; }
    .note-info a { text-decoration: none; }
    .note-info small { color: #666; }
    .note-actions { display: flex; gap: 8px; }
    .note-actions a { font-size: 14px; }
  `;

  const notesList = notes.length === 0
    ? '<p style="color: #666; text-align: center;">No notes yet. Create your first one!</p>'
    : notes.map(note => `
      <div class="note-item">
        <div class="note-info">
          <a href="/admin/edit/${note.id}"><strong>#${note.id}</strong> – ${escapeHtml(note.title)}</a><br>
          <small>${new Date(note.created).toLocaleDateString()}</small>
        </div>
        <div class="note-actions">
          <a href="/${note.id}" target="_blank">view</a>
          <a href="/admin/edit/${note.id}">edit</a>
          <a href="/admin/delete/${note.id}" style="color: #c0392b;">delete</a>
        </div>
      </div>
    `).join('');

  const content = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 32px;">
      <h1 style="${TITLE_FONT} font-size: 24px;">Notes Admin</h1>
      <a href="/admin/logout" style="font-size: 14px;">logout</a>
    </div>
    <div style="margin-bottom: 32px;">
      <a href="/admin/new"><button>+ New Note</button></a>
    </div>
    <div>${notesList}</div>
  `;

  return htmlTemplate('Admin – Notes', content, extraStyles);
}

export function renderNoteEditor(note?: Note): string {
  const isEdit = !!note;
  const title = isEdit ? `Edit #${note.id}` : 'New Note';
  const formAction = isEdit ? `/admin/edit/${note.id}` : '/admin/new';

  const content = `
    <h1 style="${TITLE_FONT} font-size: 24px; margin-bottom: 32px;">${title}</h1>
    <form method="POST" action="${formAction}">
      <div class="form-group">
        <label for="title">Title</label>
        <input type="text" id="title" name="title" value="${escapeHtml(note?.title || '')}" required>
      </div>
      <div class="form-group">
        <label for="content">Content (Markdown)</label>
        <textarea id="content" name="content" required>${escapeHtml(note?.content || '')}</textarea>
      </div>
      <div class="btn-group">
        <button type="submit">${isEdit ? 'Update' : 'Create'} Note</button>
        <a href="/admin"><button type="button" class="secondary">Cancel</button></a>
      </div>
    </form>
  `;

  return htmlTemplate(title, content, ADMIN_STYLES);
}

export function renderDeleteConfirm(note: Note): string {
  const content = `
    <h1 style="${TITLE_FONT} font-size: 24px; margin-bottom: 32px;">Delete Note</h1>
    <p style="margin-bottom: 24px;">Are you sure you want to delete <strong>#${note.id} – ${escapeHtml(note.title)}</strong>?</p>
    <form method="POST" action="/admin/delete/${note.id}">
      <div class="btn-group">
        <button type="submit" class="danger">Delete</button>
        <a href="/admin"><button type="button" class="secondary">Cancel</button></a>
      </div>
    </form>
  `;

  return htmlTemplate(`Delete #${note.id}`, content, ADMIN_STYLES);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
