import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import type { Env, Note, NoteMeta, Draft, DraftMeta } from './types';
import { ensureOgImage, getOgImageUrl } from './og-image';

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
const DRAFT_INDEX_KEY = 'meta:draft_index';
const NOTE_INDEX_KEY = 'meta:note_index';

/**
 * Extract plain text excerpt from HTML content (truncates at word boundary)
 */
function extractExcerpt(htmlContent: string, maxLength = 150): string {
  // Limit input size to prevent regex performance issues on large content
  const limitedHtml = htmlContent.slice(0, 2000);
  const text = limitedHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  const truncated = text.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > maxLength * 0.7) {
    return truncated.slice(0, lastSpace) + '…';
  }
  return truncated + '…';
}

/**
 * Generate a sequential note ID with collision detection.
 * Format: 4-digit zero-padded number (e.g., "0001", "0002")
 *
 * Uses optimistic locking: if a collision is detected (note already exists),
 * the function retries with the next available ID.
 */
export async function generateNoteId(env: Env): Promise<string> {
  const MAX_RETRIES = 5;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const counter = await env.NOTES_KV.get(COUNTER_KEY);
    const nextNum = counter ? parseInt(counter, 10) + 1 : 1;
    const id = nextNum.toString().padStart(4, '0');

    // Check if a note with this ID already exists (collision detection)
    const existing = await env.NOTES_KV.get(`note:${id}`);
    if (existing === null) {
      // No collision - claim this ID
      await env.NOTES_KV.put(COUNTER_KEY, nextNum.toString());
      return id;
    }

    // Collision detected - update counter to reflect the existing note and retry
    await env.NOTES_KV.put(COUNTER_KEY, nextNum.toString());
  }

  throw new Error('Failed to generate unique note ID after maximum retries');
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

  // Generate OG image if first publish or title changed
  // This is done async and won't block saving the note
  const needsOgImage = !existing || existing.title !== title;
  let ogImageUrl = existing?.ogImageUrl || getOgImageUrl(id);
  
  // Save the note first, then try to generate OG image
  const note: Note = {
    id,
    title,
    content,
    htmlContent,
    ogImageUrl,
    created: existing?.created || now,
    updated: now,
  };

  // Generate excerpt for index page
  const excerpt = extractExcerpt(htmlContent, 150);

  // Create metadata with excerpt
  const noteMeta: NoteMeta = {
    id: note.id,
    title: note.title,
    excerpt,
    created: note.created,
    updated: note.updated,
  };

  // Store the full note
  await env.NOTES_KV.put(`note:${id}`, JSON.stringify(note), {
    metadata: noteMeta,
  });

  // Update the note index for immediate consistency
  if (!existing) {
    await addToNoteIndex(env, noteMeta);
  } else {
    await updateNoteInIndex(env, noteMeta);
  }

  // Generate OG image asynchronously (non-blocking, no second KV write needed)
  // The OG URL is deterministic based on note ID, so no need to store it again
  if (needsOgImage) {
    ensureOgImage(env, id, title, existing?.title).catch(error => {
      console.error(`Failed to generate OG image for note ${id}:`, error);
    });
  }

  return note;
}

export async function deleteNote(env: Env, id: string): Promise<boolean> {
  const note = await getNote(env, id);
  if (!note) return false;
  await env.NOTES_KV.delete(`note:${id}`);
  await removeFromNoteIndex(env, id);
  return true;
}

// Note index management for immediate consistency
async function getNoteIndex(env: Env): Promise<NoteMeta[]> {
  const index = await env.NOTES_KV.get(NOTE_INDEX_KEY, { type: 'json' });
  return (index as NoteMeta[]) || [];
}

async function addToNoteIndex(env: Env, meta: NoteMeta): Promise<void> {
  const index = await getNoteIndex(env);
  index.unshift(meta); // Add to beginning (newest first)
  await env.NOTES_KV.put(NOTE_INDEX_KEY, JSON.stringify(index));
}

async function updateNoteInIndex(env: Env, meta: NoteMeta): Promise<void> {
  const index = await getNoteIndex(env);
  const idx = index.findIndex(n => n.id === meta.id);
  if (idx >= 0) {
    index[idx] = meta;
    await env.NOTES_KV.put(NOTE_INDEX_KEY, JSON.stringify(index));
  }
}

async function removeFromNoteIndex(env: Env, id: string): Promise<void> {
  const index = await getNoteIndex(env);
  const filtered = index.filter(n => n.id !== id);
  await env.NOTES_KV.put(NOTE_INDEX_KEY, JSON.stringify(filtered));
}

/**
 * Rebuild the note index by fetching all notes and regenerating excerpts.
 * Used for migration when excerpt field was added.
 */
async function rebuildNoteIndex(env: Env): Promise<void> {
  const result = await env.NOTES_KV.list({ prefix: 'note:' });
  const newIndex: NoteMeta[] = [];

  for (const key of result.keys) {
    const note = await env.NOTES_KV.get(key.name, { type: 'json' }) as Note | null;
    if (note) {
      const excerpt = extractExcerpt(note.htmlContent, 150);
      newIndex.push({
        id: note.id,
        title: note.title,
        excerpt,
        created: note.created,
        updated: note.updated,
      });
    }
  }

  // Sort by created date (newest first)
  newIndex.sort((a, b) => b.created - a.created);
  await env.NOTES_KV.put(NOTE_INDEX_KEY, JSON.stringify(newIndex));
}

export async function getAllNotes(env: Env): Promise<NoteMeta[]> {
  // First try to get from index (immediate consistency)
  const index = await getNoteIndex(env);
  if (index.length > 0) {
    // Check if index has excerpts (migration check)
    const needsMigration = index.some(n => !n.excerpt);
    if (!needsMigration) {
      return index.sort((a, b) => b.created - a.created);
    }
    // Index needs migration - rebuild it
    await rebuildNoteIndex(env);
    const newIndex = await getNoteIndex(env);
    return newIndex.sort((a, b) => b.created - a.created);
  }

  // Fall back to list() for initial migration
  const result = await env.NOTES_KV.list({ prefix: 'note:' });
  const notes: NoteMeta[] = result.keys
    .map((key) => key.metadata as NoteMeta)
    .filter((meta) => meta !== null && meta !== undefined)
    .sort((a, b) => b.created - a.created);

  // Populate the index for future use
  if (notes.length > 0) {
    await env.NOTES_KV.put(NOTE_INDEX_KEY, JSON.stringify(notes));
  }
  
  return notes;
}

export async function getLatestNote(env: Env): Promise<Note | null> {
  const notes = await getAllNotes(env);
  if (notes.length === 0) return null;
  return getNote(env, notes[0].id);
}

export async function getPreviousNoteId(env: Env, currentId: string): Promise<string | null> {
  // Find the note created just before the current one using the index
  // (no need to fetch the full note - we only need to find the ID in the list)
  const notes = await getAllNotes(env);
  const currentIndex = notes.findIndex((n) => n.id === currentId);

  // Previous note is the next one in the array (since sorted newest first)
  if (currentIndex >= 0 && currentIndex < notes.length - 1) {
    return notes[currentIndex + 1].id;
  }
  return null;
}

// Timezone utilities for scheduled publishing

/**
 * Parse a datetime string in Europe/Zurich and return UTC timestamp.
 * Input format: "2026-01-27T14:30" (from HTML datetime-local input)
 *
 * Note: Uses Intl.DateTimeFormat for proper DST handling.
 */
export function parseZurichToUTC(localDateTime: string): number {
  // Parse the local datetime components
  const [datePart, timePart] = localDateTime.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute] = timePart.split(':').map(Number);

  // Create a date in UTC, then find what UTC time corresponds to this local time in Zurich
  // We do this by creating a formatter for Zurich and working backwards
  const targetLocal = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));

  // Get the offset for Zurich at this date (handles DST)
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Zurich',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  // Find the UTC time that displays as the target local time in Zurich
  // Binary search approach: start with a guess and refine
  let utcGuess = targetLocal.getTime();

  // Parse what the guess looks like in Zurich
  const parts = formatter.formatToParts(new Date(utcGuess));
  const zurichHour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
  const zurichMinute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);

  // Calculate the offset
  const offsetMinutes = (zurichHour - hour) * 60 + (zurichMinute - minute);

  // Adjust for the offset
  return utcGuess - offsetMinutes * 60 * 1000;
}

/**
 * Format UTC timestamp to Europe/Zurich display string.
 */
export function formatZurichTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('en-GB', {
    timeZone: 'Europe/Zurich',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Get the current datetime in Europe/Zurich as an ISO-like string for datetime-local input.
 * Returns format: "2026-01-27T14:30"
 */
export function getZurichDateTimeLocal(timestamp: number): string {
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Zurich',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  // sv-SE locale gives us YYYY-MM-DD HH:MM format
  return formatter.format(new Date(timestamp)).replace(' ', 'T');
}

// Draft functions

/**
 * Generate a random draft ID using crypto
 */
export function generateDraftId(): string {
  const array = new Uint8Array(12);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function getDraft(env: Env, id: string): Promise<Draft | null> {
  const draft = await env.NOTES_KV.get(`draft:${id}`, { type: 'json' });
  return draft as Draft | null;
}

export async function saveDraft(
  env: Env,
  id: string,
  title: string,
  content: string,
  scheduledFor?: number | null
): Promise<Draft> {
  const existing = await getDraft(env, id);
  const now = Date.now();

  // scheduledFor: undefined = keep existing, null = clear, number = set
  const finalScheduledFor = scheduledFor === undefined
    ? existing?.scheduledFor
    : (scheduledFor === null ? undefined : scheduledFor);

  const draft: Draft = {
    id,
    title,
    content,
    scheduledFor: finalScheduledFor,
    created: existing?.created || now,
    updated: now,
  };

  const meta: DraftMeta = {
    id: draft.id,
    title: draft.title,
    scheduledFor: draft.scheduledFor,
    created: draft.created,
    updated: draft.updated,
  };

  await env.NOTES_KV.put(`draft:${id}`, JSON.stringify(draft), {
    metadata: meta,
  });

  // Update the draft index for immediate consistency
  if (!existing) {
    await addToDraftIndex(env, meta);
  } else {
    await updateDraftInIndex(env, meta);
  }

  return draft;
}

export async function deleteDraft(env: Env, id: string): Promise<boolean> {
  const draft = await getDraft(env, id);
  if (!draft) return false;
  await env.NOTES_KV.delete(`draft:${id}`);
  await removeFromDraftIndex(env, id);
  return true;
}

// Draft index management for immediate consistency
async function getDraftIndex(env: Env): Promise<DraftMeta[]> {
  const index = await env.NOTES_KV.get(DRAFT_INDEX_KEY, { type: 'json' });
  return (index as DraftMeta[]) || [];
}

async function addToDraftIndex(env: Env, meta: DraftMeta): Promise<void> {
  const index = await getDraftIndex(env);
  index.unshift(meta); // Add to beginning (newest first)
  await env.NOTES_KV.put(DRAFT_INDEX_KEY, JSON.stringify(index));
}

async function updateDraftInIndex(env: Env, meta: DraftMeta): Promise<void> {
  const index = await getDraftIndex(env);
  const idx = index.findIndex(d => d.id === meta.id);
  if (idx >= 0) {
    index[idx] = meta;
    await env.NOTES_KV.put(DRAFT_INDEX_KEY, JSON.stringify(index));
  }
}

async function removeFromDraftIndex(env: Env, id: string): Promise<void> {
  const index = await getDraftIndex(env);
  const filtered = index.filter(d => d.id !== id);
  await env.NOTES_KV.put(DRAFT_INDEX_KEY, JSON.stringify(filtered));
}

export async function getAllDrafts(env: Env): Promise<DraftMeta[]> {
  // First try to get from index (immediate consistency)
  const index = await getDraftIndex(env);
  if (index.length > 0) {
    return index.sort((a, b) => b.updated - a.updated);
  }
  
  // Fall back to list() for initial migration
  const result = await env.NOTES_KV.list({ prefix: 'draft:' });
  const drafts: DraftMeta[] = result.keys
    .map((key) => key.metadata as DraftMeta)
    .filter((meta) => meta !== null && meta !== undefined)
    .sort((a, b) => b.updated - a.updated);
  
  // Populate the index for future use
  if (drafts.length > 0) {
    await env.NOTES_KV.put(DRAFT_INDEX_KEY, JSON.stringify(drafts));
  }
  
  return drafts;
}
