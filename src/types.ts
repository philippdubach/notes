export interface Env {
  NOTES_KV: KVNamespace;
  STATIC_R2: R2Bucket;
  ADMIN_PASSWORD: string;
}

export interface Note {
  id: string; // "0001", "0002", etc.
  title: string;
  content: string; // Markdown content
  htmlContent: string; // Rendered HTML
  ogImageUrl?: string; // Open Graph image URL
  created: number; // Unix timestamp
  updated: number;
}

export interface NoteMeta {
  id: string;
  title: string;
  excerpt: string; // Plain text excerpt for index page
  created: number;
  updated: number;
}

export interface Draft {
  id: string; // UUID for drafts
  title: string;
  content: string; // Markdown content
  scheduledFor?: number; // Unix timestamp (UTC) for scheduled publishing
  created: number; // Unix timestamp
  updated: number;
}

export interface DraftMeta {
  id: string;
  title: string;
  scheduledFor?: number; // Unix timestamp (UTC)
  created: number;
  updated: number;
}
