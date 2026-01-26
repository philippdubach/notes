import { ImageResponse, loadGoogleFont } from 'workers-og';
import type { Env } from './types';

// OG image dimensions (standard 1200x630)
const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

// Background image URL (cache-bust with version param when image changes)
const BG_IMAGE_URL = 'https://static.philippdubach.com/ograph/notes/ograph-notes-background.jpg?v=2';

// R2 path prefix for OG images
const OG_R2_PREFIX = 'ograph/notes/';

// Static URL base
const STATIC_URL_BASE = 'https://static.philippdubach.com/';

/**
 * SSRF Protection: Allowlist of domains that can be fetched.
 * This prevents any future refactoring from accidentally introducing SSRF.
 */
const ALLOWED_FETCH_DOMAINS = [
  'static.philippdubach.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

/**
 * Validate that a URL is safe to fetch (SSRF prevention).
 * Blocks internal IPs, metadata services, and non-allowlisted domains.
 */
function isUrlSafeToFetch(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    
    // Must be HTTPS (or HTTP for localhost in dev, but we block localhost anyway)
    if (url.protocol !== 'https:') {
      return false;
    }
    
    // Block internal/private IP ranges and metadata services
    const hostname = url.hostname.toLowerCase();
    const blockedPatterns = [
      /^localhost$/i,
      /^127\./,
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
      /^192\.168\./,
      /^169\.254\./, // Link-local / AWS metadata
      /^0\./, // Current network
      /^::1$/, // IPv6 localhost
      /^fc00:/i, // IPv6 private
      /^fe80:/i, // IPv6 link-local
      /metadata\.google\.internal/i,
      /metadata\.azure\.internal/i,
    ];
    
    for (const pattern of blockedPatterns) {
      if (pattern.test(hostname)) {
        console.warn(`SSRF Protection: Blocked fetch to ${hostname}`);
        return false;
      }
    }
    
    // Check allowlist
    if (!ALLOWED_FETCH_DOMAINS.includes(hostname)) {
      console.warn(`SSRF Protection: Domain not in allowlist: ${hostname}`);
      return false;
    }
    
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate an Open Graph image with the note title overlaid on the background
 */
async function generateOgImage(title: string): Promise<ArrayBuffer> {
  // SSRF Protection: Validate URL before fetching
  if (!isUrlSafeToFetch(BG_IMAGE_URL)) {
    throw new Error('Background image URL failed security validation');
  }
  
  // Fetch background image and convert to base64 (no-cache to get latest)
  const bgResponse = await fetch(BG_IMAGE_URL, {
    cf: { cacheTtl: 0, cacheEverything: false }
  });
  const bgBuffer = await bgResponse.arrayBuffer();
  const bgBase64 = btoa(String.fromCharCode(...new Uint8Array(bgBuffer)));
  const bgDataUrl = `data:image/jpeg;base64,${bgBase64}`;
  
  // Load EB Garamond font (similar to Georgia)
  const fontData = await loadGoogleFont({
    family: 'EB Garamond',
    weight: 400,
  });
  
  // Text position: moved up by 40% from original (bottom padding ~250px)
  const bottomPadding = 250;
  
  // Create HTML template for the OG image
  // Using absolute positioning to layer background and text
  const html = `
    <div style="display: flex; position: relative; width: ${OG_WIDTH}px; height: ${OG_HEIGHT}px;">
      <img src="${bgDataUrl}" width="${OG_WIDTH}" height="${OG_HEIGHT}" style="position: absolute; top: 0; left: 0;" />
      <div style="display: flex; flex-direction: column; justify-content: flex-end; position: absolute; top: 0; left: 0; width: ${OG_WIDTH}px; height: ${OG_HEIGHT}px;">
        <div style="display: flex; padding: 0 80px ${bottomPadding}px 80px;">
          <span style="font-family: 'EB Garamond'; font-size: 64px; font-weight: 400; color: #1a1a1a; line-height: 1.2;">${escapeHtml(title)}</span>
        </div>
      </div>
    </div>
  `;
  
  // Generate PNG using workers-og with high quality
  const response = new ImageResponse(html, {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    fonts: [
      {
        name: 'EB Garamond',
        data: fontData,
        weight: 400,
        style: 'normal',
      },
    ],
  });
  
  return response.arrayBuffer();
}

/**
 * Escape HTML special characters to prevent XSS in the template
 * Note: apostrophes are safe in HTML content and don't need escaping
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Upload an OG image to R2 and return its public URL
 */
async function uploadOgImage(
  env: Env,
  noteId: string,
  imageData: ArrayBuffer
): Promise<string> {
  const key = `${OG_R2_PREFIX}${noteId}.png`;
  
  await env.STATIC_R2.put(key, imageData, {
    httpMetadata: {
      contentType: 'image/png',
      cacheControl: 'public, max-age=31536000',
    },
  });
  
  return `${STATIC_URL_BASE}${key}`;
}

/**
 * Get the OG image URL for a note
 */
export function getOgImageUrl(noteId: string): string {
  return `${STATIC_URL_BASE}${OG_R2_PREFIX}${noteId}.png`;
}

/**
 * Generate and upload OG image if needed (first publish or title change)
 * Returns the OG image URL
 */
export async function ensureOgImage(
  env: Env,
  noteId: string,
  title: string,
  existingTitle?: string
): Promise<string> {
  const ogUrl = getOgImageUrl(noteId);
  
  // Check if we need to generate a new image:
  // 1. First publish (no existing title)
  // 2. Title has changed
  const needsGeneration = !existingTitle || existingTitle !== title;
  
  if (needsGeneration) {
    try {
      const imageData = await generateOgImage(title);
      await uploadOgImage(env, noteId, imageData);
      console.log(`Generated OG image for note ${noteId}`);
    } catch (error) {
      console.error(`Failed to generate OG image for note ${noteId}:`, error);
      // Return URL anyway - will fall back to default image
    }
  }
  
  return ogUrl;
}
