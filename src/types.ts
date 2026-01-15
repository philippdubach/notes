export interface Env {
  NOTES_KV: KVNamespace;
  ADMIN_PASSWORD: string;
}

export interface Note {
  id: string; // "0001", "0002", etc.
  title: string;
  content: string; // Markdown content
  htmlContent: string; // Rendered HTML
  created: number; // Unix timestamp
  updated: number;
}

export interface NoteMeta {
  id: string;
  title: string;
  created: number;
  updated: number;
}
