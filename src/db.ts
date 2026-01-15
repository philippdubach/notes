import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { nanoid } from 'nanoid';
import type { Env, Note, NoteMeta } from './types';

// Configure marked for security
marked.setOptions({
  gfm: true,
  breaks: true,
});

// Sanitization config - allow safe HTML from Markdown, block all scripts
const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2', 'h3']),
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    'img': ['src', 'alt', 'title'],
    'a': ['href', 'title', 'target', 'rel'],
    'code': ['class'],
    'pre': ['class'],
    'span': ['class'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  // Strip all event handlers and dangerous protocols
  disallowedTagsMode: 'discard',
};

const COUNTER_KEY = 'meta:counter';

/**
 * Generate a unique note ID using nanoid.
 * This prevents race conditions that existed with sequential counter.
 * Format: 8 alphanumeric characters (e.g., "V1StGXR8")
 */
export async function generateNoteId(): Promise<string> {
  return nanoid(8);
}

/**
 * @deprecated Use generateNoteId() instead - sequential IDs have race condition vulnerabilities
 */
export async function getNextNoteNumber(env: Env): Promise<string> {
  const counter = await env.NOTES_KV.get(COUNTER_KEY);
  const nextNum = counter ? parseInt(counter, 10) + 1 : 1;
  await env.NOTES_KV.put(COUNTER_KEY, nextNum.toString());
  return nextNum.toString().padStart(4, '0');
}

export async function getNote(env: Env, id: string): Promise<Note | null> {
  const note = await env.NOTES_KV.get(`note:${id}`, { type: 'json' });
  return note as Note | null;
}

export async function saveNote(
  env: Env,
  id: string,
  title: string,
  content: string
): Promise<Note> {
  const existing = await getNote(env, id);
  const now = Date.now();
  // Parse Markdown then sanitize to prevent XSS
  const rawHtml = await marked.parse(content);
  const htmlContent = sanitizeHtml(rawHtml, SANITIZE_OPTIONS);

  const note: Note = {
    id,
    title,
    content,
    htmlContent,
    created: existing?.created || now,
    updated: now,
  };

  // Store the full note
  await env.NOTES_KV.put(`note:${id}`, JSON.stringify(note), {
    metadata: {
      id: note.id,
      title: note.title,
      created: note.created,
      updated: note.updated,
    } as NoteMeta,
  });

  return note;
}

export async function deleteNote(env: Env, id: string): Promise<boolean> {
  const note = await getNote(env, id);
  if (!note) return false;
  await env.NOTES_KV.delete(`note:${id}`);
  return true;
}

export async function getAllNotes(env: Env): Promise<NoteMeta[]> {
  const result = await env.NOTES_KV.list({ prefix: 'note:' });
  const notes: NoteMeta[] = result.keys
    .map((key) => key.metadata as NoteMeta)
    .filter((meta) => meta !== null && meta !== undefined)
    // Sort by created timestamp descending (newest first)
    // This works with both legacy numeric IDs and new nanoid format
    .sort((a, b) => b.created - a.created);
  return notes;
}

export async function getLatestNote(env: Env): Promise<Note | null> {
  const notes = await getAllNotes(env);
  if (notes.length === 0) return null;
  return getNote(env, notes[0].id);
}

export async function getPreviousNoteId(env: Env, currentId: string): Promise<string | null> {
  const currentNote = await getNote(env, currentId);
  if (!currentNote) return null;
  
  // Find the note created just before the current one
  const notes = await getAllNotes(env);
  const currentIndex = notes.findIndex((n) => n.id === currentId);
  
  // Previous note is the next one in the array (since sorted newest first)
  if (currentIndex >= 0 && currentIndex < notes.length - 1) {
    return notes[currentIndex + 1].id;
  }
  return null;
}

export async function getNextNoteId(env: Env, currentId: string): Promise<string | null> {
  const currentNote = await getNote(env, currentId);
  if (!currentNote) return null;
  
  // Find the note created just after the current one
  const notes = await getAllNotes(env);
  const currentIndex = notes.findIndex((n) => n.id === currentId);
  
  // Next note is the previous one in the array (since sorted newest first)
  if (currentIndex > 0) {
    return notes[currentIndex - 1].id;
  }
  return null;
}
