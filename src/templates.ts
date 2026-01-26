import type { Note, NoteMeta, Draft, DraftMeta } from './types';
import { formatZurichTime, getZurichDateTimeLocal } from './db';

// OG image fallback URL
const OG_IMAGE_FALLBACK = 'https://static.philippdubach.com/ograph/notes/ograph-notes-background.jpg';

// Escape HTML to prevent XSS
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Escape strings for use in JavaScript
function escapeJs(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

// Escape strings for use in XML
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Extract plain text excerpt from HTML content (truncates at word boundary)
export function extractExcerpt(htmlContent: string, maxLength = 150): string {
  const text = htmlContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  // Find last space before maxLength to avoid cutting mid-word
  const truncated = text.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > maxLength * 0.7) {
    return truncated.slice(0, lastSpace) + '…';
  }
  return truncated + '…';
}

// RSS Feed generation
export function generateRssFeed(notes: Note[]): string {
  const now = new Date().toUTCString();

  const items = notes.map(note => {
    const pubDate = new Date(note.created).toUTCString();
    const link = `https://notes.philippdubach.com/${note.id}`;
    return `
    <item>
      <title>${escapeXml(note.title)}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <pubDate>${pubDate}</pubDate>
      <description><![CDATA[${note.htmlContent}]]></description>
    </item>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet href="/feed.xsl" type="text/xsl"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Notes by Philipp D. Dubach</title>
    <link>https://notes.philippdubach.com</link>
    <description>Short reflections and observations</description>
    <language>en</language>
    <lastBuildDate>${now}</lastBuildDate>
    <atom:link href="https://notes.philippdubach.com/feed.xml" rel="self" type="application/rss+xml"/>${items}
  </channel>
</rss>`;
}

// XSL Stylesheet for RSS feed (renders nicely in browsers)
export const RSS_XSL_STYLESHEET = `<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="html" encoding="UTF-8"/>
  <xsl:template match="/">
    <html>
      <head>
        <meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
        <title><xsl:value-of select="/rss/channel/title"/> – RSS Feed</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { background: #f8f6f1; color: #1a1a1a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 16px; line-height: 1.7; }
          .container { max-width: 600px; margin: 0 auto; padding: 80px 24px; }
          h1 { font-family: Georgia, 'Times New Roman', serif; font-size: 32px; font-weight: normal; margin-bottom: 8px; }
          .description { color: #666; margin-bottom: 32px; }
          .rss-info { background: #e8e6e1; padding: 16px; border-radius: 4px; margin-bottom: 48px; font-size: 14px; color: #555; }
          .rss-info a { color: #1a1a1a; }
          .item { margin-bottom: 24px; }
          .item-title { font-family: Georgia, 'Times New Roman', serif; font-size: 18px; margin-bottom: 4px; }
          .item-title a { color: #1a1a1a; text-decoration: none; }
          .item-title a:hover { opacity: 0.7; }
          .item-date { font-size: 13px; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1><xsl:value-of select="/rss/channel/title"/></h1>
          <p class="description"><xsl:value-of select="/rss/channel/description"/></p>
          <div class="rss-info">
            This is an RSS feed. Copy the URL into your feed reader to subscribe. <a href="https://aboutfeeds.com/">What is RSS?</a>
          </div>
          <xsl:for-each select="/rss/channel/item">
            <div class="item">
              <div class="item-title">
                <a><xsl:attribute name="href"><xsl:value-of select="link"/></xsl:attribute><xsl:value-of select="title"/></a>
              </div>
              <div class="item-date"><xsl:value-of select="pubDate"/></div>
            </div>
          </xsl:for-each>
        </div>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>`;

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
  @media (max-width: 640px) {
    .container { padding: 48px 20px; }
  }
  @media (max-width: 480px) {
    .container { padding: 32px 16px; }
  }
`;

const TITLE_FONT = `font-family: Georgia, 'Times New Roman', serif;`;

interface OgMeta {
  title: string;
  description: string;
  image: string;
  url: string;
}

interface TemplateOptions {
  extraStyles?: string;
  canonicalUrl?: string;
  ogMeta?: OgMeta;
  description?: string;
  noIndex?: boolean;
  jsonLd?: object;
}

function htmlTemplate(title: string, content: string, options: TemplateOptions | string = {}): string {
  // Support legacy signature: htmlTemplate(title, content, extraStyles, canonicalUrl, ogMeta)
  const opts: TemplateOptions = typeof options === 'string'
    ? { extraStyles: options }
    : options;

  const { extraStyles = '', canonicalUrl, ogMeta, description, noIndex, jsonLd } = opts;
  const canonicalTag = canonicalUrl ? `\n  <link rel="canonical" href="${canonicalUrl}">` : '';
  const trackingScript = canonicalUrl ? `\n  <script data-goatcounter="https://stats.philippdubach.com/count" async src="//gc.zgo.at/count.js"></script>` : '';
  const descriptionTag = description ? `\n  <meta name="description" content="${escapeHtml(description)}">` : '';
  const robotsTag = noIndex ? `\n  <meta name="robots" content="noindex, nofollow">` : '';
  const jsonLdScript = jsonLd ? `\n  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : '';

  // Skip-to-content styles for accessibility
  const a11yStyles = `
    .skip-link {
      position: absolute;
      left: -9999px;
      top: auto;
      width: 1px;
      height: 1px;
      overflow: hidden;
      z-index: 100;
    }
    .skip-link:focus {
      position: fixed;
      top: 0;
      left: 0;
      width: auto;
      height: auto;
      padding: 8px 16px;
      background: #1a1a1a;
      color: #fff;
      text-decoration: none;
    }
  `;

  // Open Graph meta tags
  const ogTags = ogMeta ? `
  <meta property="og:type" content="article">
  <meta property="og:title" content="${escapeHtml(ogMeta.title)}">
  <meta property="og:description" content="${escapeHtml(ogMeta.description)}">
  <meta property="og:image" content="${ogMeta.image}">
  <meta property="og:url" content="${ogMeta.url}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(ogMeta.title)}">
  <meta name="twitter:description" content="${escapeHtml(ogMeta.description)}">
  <meta name="twitter:image" content="${ogMeta.image}">` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>${descriptionTag}${robotsTag}${canonicalTag}${ogTags}${jsonLdScript}
  <style>${BASE_STYLES}${a11yStyles}${extraStyles}</style>
</head>
<body>
  <a href="#main-content" class="skip-link">Skip to content</a>
  <main id="main-content" class="container">
    ${content}
  </main>${trackingScript}
</body>
</html>`;
}

export function renderNotePage(note: Note, previousId: string | null, noteHasAudio = false): string {
  const audioStyles = noteHasAudio ? `
    .audio-btn {
      background: none;
      border: none;
      cursor: pointer;
      color: #767676;
      min-width: 44px;
      min-height: 44px;
      padding: 12px;
      margin: -12px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: color 0.2s;
    }
    .audio-btn:hover { color: #1a1a1a; }
    .audio-btn.playing { color: #1a1a1a; }
    .audio-time {
      font-size: 12px;
      color: #666;
      font-variant-numeric: tabular-nums;
      display: none;
    }
    .audio-time.active { display: inline; }
    .audio-disclaimer {
      font-size: 11px;
      color: #888;
      display: none;
    }
    .audio-disclaimer.active { display: inline; }
  ` : '';

  const extraStyles = `
    .header { display: flex; justify-content: space-between; align-items: center; font-size: 14px; color: #666; margin-bottom: 32px; }
    .header-left { display: flex; align-items: center; gap: 8px; }
    .header a { color: #666; text-decoration: none; }
    .header a:hover { opacity: 0.7; }
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
    .nav { display: flex; justify-content: center; gap: 16px; font-size: 14px; }
    .nav a { text-decoration: none; color: #666; }
    .nav a:hover { opacity: 0.7; }${audioStyles}
  `;

  const navLinks: string[] = [];
  navLinks.push('<a href="/all">all notes</a>');
  if (previousId) {
    navLinks.push(`<a href="/${previousId}">previous note ›</a>`);
  }

  const audioUrl = `https://static.philippdubach.com/audio/note${note.id}.mp3`;
  const artworkUrl = note.ogImageUrl || OG_IMAGE_FALLBACK;

  const audioHtml = noteHasAudio ? `
    <audio id="note-audio" preload="metadata">
      <source src="${audioUrl}" type="audio/mpeg">
    </audio>` : '';

  const audioButton = noteHasAudio ? `
        <button class="audio-btn" id="audio-btn" type="button" aria-label="Play audio">
          <svg class="icon-play" viewBox="0 0 24 24" width="14" height="14">
            <polygon points="6,3 20,12 6,21" fill="currentColor"/>
          </svg>
          <svg class="icon-pause" viewBox="0 0 24 24" width="14" height="14" style="display:none;">
            <rect x="5" y="3" width="4" height="18" fill="currentColor"/>
            <rect x="15" y="3" width="4" height="18" fill="currentColor"/>
          </svg>
        </button>
        <span class="audio-time" id="audio-time"></span>
        <span class="audio-disclaimer" id="audio-disclaimer">AI-generated audio</span>` : '';

  const audioScript = noteHasAudio ? `
    <script>
    (function() {
      var audio = document.getElementById('note-audio');
      var btn = document.getElementById('audio-btn');
      var timeDisplay = document.getElementById('audio-time');
      var iconPlay = btn.querySelector('.icon-play');
      var iconPause = btn.querySelector('.icon-pause');
      var disclaimer = document.getElementById('audio-disclaimer');

      function formatTime(seconds) {
        if (!isFinite(seconds)) return '--:--';
        var mins = Math.floor(seconds / 60);
        var secs = Math.floor(seconds % 60);
        return mins + ':' + (secs < 10 ? '0' : '') + secs;
      }

      btn.addEventListener('click', function() {
        if (audio.paused) {
          audio.play();
        } else {
          audio.pause();
        }
      });

      audio.addEventListener('play', function() {
        iconPlay.style.display = 'none';
        iconPause.style.display = 'block';
        btn.classList.add('playing');
        timeDisplay.classList.add('active');
        disclaimer.classList.add('active');

        if ('mediaSession' in navigator) {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: '${escapeJs(note.title)}',
            artist: 'Philipp D. Dubach',
            album: 'Notes',
            artwork: [
              { src: '${artworkUrl}', sizes: '1200x630', type: 'image/jpeg' }
            ]
          });
          navigator.mediaSession.setActionHandler('play', function() { audio.play(); });
          navigator.mediaSession.setActionHandler('pause', function() { audio.pause(); });
          navigator.mediaSession.setActionHandler('seekbackward', function() {
            audio.currentTime = Math.max(0, audio.currentTime - 10);
          });
          navigator.mediaSession.setActionHandler('seekforward', function() {
            audio.currentTime = isFinite(audio.duration) ? Math.min(audio.duration, audio.currentTime + 10) : audio.currentTime + 10;
          });
        }
      });

      audio.addEventListener('pause', function() {
        iconPlay.style.display = 'block';
        iconPause.style.display = 'none';
        btn.classList.remove('playing');
      });

      audio.addEventListener('timeupdate', function() {
        if (isFinite(audio.duration)) {
          timeDisplay.textContent = formatTime(audio.currentTime) + ' / ' + formatTime(audio.duration);
          if ('mediaSession' in navigator && 'setPositionState' in navigator.mediaSession) {
            navigator.mediaSession.setPositionState({
              duration: audio.duration,
              playbackRate: audio.playbackRate,
              position: audio.currentTime
            });
          }
        } else {
          timeDisplay.textContent = formatTime(audio.currentTime);
        }
      });

      audio.addEventListener('ended', function() {
        iconPlay.style.display = 'block';
        iconPause.style.display = 'none';
        btn.classList.remove('playing');
        timeDisplay.classList.remove('active');
        disclaimer.classList.remove('active');
      });
    })();
    </script>` : '';

  const content = `${audioHtml}
    <article>
      <header class="header">
        <div class="header-left">
          <span>#${note.id}</span>${audioButton}
        </div>
        <a href="https://philippdubach.com/posts/notes-the-space-between/">about</a>
      </header>
      <h1 class="note-title">${escapeHtml(note.title)}</h1>
      <div class="note-body">${note.htmlContent}</div>
    </article>
    ${navLinks.length > 0 ? `<nav class="nav" aria-label="Note navigation">${navLinks.join('')}</nav>` : ''}${audioScript}
  `;

  const canonicalUrl = `https://notes.philippdubach.com/${note.id}`;
  const description = extractExcerpt(note.htmlContent, 160);
  const ogMeta: OgMeta = {
    title: note.title,
    description,
    image: note.ogImageUrl || OG_IMAGE_FALLBACK,
    url: canonicalUrl,
  };

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: note.title,
    datePublished: new Date(note.created).toISOString(),
    dateModified: new Date(note.updated).toISOString(),
    author: {
      '@type': 'Person',
      name: 'Philipp D. Dubach',
      url: 'https://philippdubach.com',
    },
    publisher: {
      '@type': 'Person',
      name: 'Philipp D. Dubach',
      url: 'https://philippdubach.com',
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': canonicalUrl,
    },
    description,
    url: canonicalUrl,
  };

  return htmlTemplate(`#${note.id} – ${note.title}`, content, {
    extraStyles,
    canonicalUrl,
    ogMeta,
    description,
    jsonLd,
  });
}

export function renderEmptyPage(): string {
  const content = `
    <p style="text-align: center; color: #666;">No notes yet.</p>
  `;
  return htmlTemplate('Notes', content, {
    description: 'Short reflections and observations by Philipp D. Dubach.',
  });
}

export function render404Page(): string {
  const content = `
    <p style="text-align: center; color: #666;">Note not found.</p>
    <p style="text-align: center; margin-top: 24px;"><a href="/">← back to latest</a></p>
  `;
  return htmlTemplate('Not Found', content, {
    description: 'The requested note was not found.',
    noIndex: true,
  });
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
  return htmlTemplate('Admin Login', content, { extraStyles: ADMIN_STYLES, noIndex: true });
}

export function renderAdminDashboard(notes: NoteMeta[], drafts: DraftMeta[] = []): string {
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
    .section-title { font-size: 14px; color: #666; margin: 24px 0 12px; text-transform: uppercase; letter-spacing: 0.5px; }
    .draft-badge { background: #f0ad4e; color: #fff; font-size: 11px; padding: 2px 6px; border-radius: 3px; margin-left: 8px; }
    .scheduled-badge { background: #2e7d32; color: #fff; font-size: 11px; padding: 2px 6px; border-radius: 3px; margin-left: 8px; }
  `;

  const draftsList = drafts.length === 0
    ? ''
    : `
      <div class="section-title">Drafts</div>
      ${drafts.map(draft => {
        const badge = draft.scheduledFor
          ? `<span class="scheduled-badge">scheduled: ${formatZurichTime(draft.scheduledFor)}</span>`
          : '<span class="draft-badge">draft</span>';
        return `
        <div class="note-item">
          <div class="note-info">
            <a href="/admin/draft/${draft.id}"><strong>${escapeHtml(draft.title) || '(untitled)'}</strong>${badge}</a><br>
            <small>Updated ${new Date(draft.updated).toLocaleDateString()}</small>
          </div>
          <div class="note-actions">
            <a href="/admin/draft/${draft.id}">edit</a>
            <a href="/admin/draft/${draft.id}/delete" style="color: #c0392b;">delete</a>
          </div>
        </div>
      `}).join('')}
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
    ${draftsList}
    ${drafts.length > 0 ? '<div class="section-title">Published</div>' : ''}
    <div>${notesList}</div>
  `;

  return htmlTemplate('Admin – Notes', content, { extraStyles, noIndex: true });
}

export function renderNoteEditor(note?: Note, isDraft?: boolean, draft?: Draft): string {
  const isEdit = !!note;
  const title = isDraft ? 'Edit Draft' : (isEdit ? `Edit #${note.id}` : 'New Note');
  const formAction = isDraft ? `/admin/draft/${note?.id}` : (isEdit ? `/admin/edit/${note.id}` : '/admin/new');

  // Get schedule info from draft if available
  const scheduledFor = draft?.scheduledFor;
  const isScheduled = !!scheduledFor;

  // For new notes: show Publish and Save as Draft
  // For drafts: show Publish, Schedule, and Update Draft
  // For published notes: show Update Note only
  let buttons: string;
  let scheduleSection = '';

  if (!isEdit) {
    // New note
    buttons = `
      <button type="submit" name="action" value="publish">Publish</button>
      <button type="submit" name="action" value="draft" class="secondary">Save as Draft</button>
      <a href="/admin"><button type="button" class="secondary">Cancel</button></a>
    `;
  } else if (isDraft) {
    // Editing a draft - show scheduling options
    const minDateTime = getZurichDateTimeLocal(Date.now() + 60000); // At least 1 minute from now

    scheduleSection = `
      <div class="form-group schedule-section">
        <label>Schedule publication (Zurich time)</label>
        ${isScheduled ? `
          <p class="schedule-status">
            <strong>Scheduled for:</strong> ${formatZurichTime(scheduledFor)}
          </p>
        ` : ''}
        <div class="schedule-inputs">
          <input type="datetime-local" id="scheduleDateTime" name="scheduleDateTime"
            min="${minDateTime}"
            value="${isScheduled ? getZurichDateTimeLocal(scheduledFor) : ''}"
            style="flex: 1;">
          <button type="submit" name="action" value="schedule" class="schedule-btn">
            ${isScheduled ? 'Update Schedule' : 'Schedule'}
          </button>
          ${isScheduled ? `
            <button type="submit" name="action" value="clearSchedule" class="secondary">Clear</button>
          ` : ''}
        </div>
      </div>
    `;

    buttons = `
      <button type="submit" name="action" value="publish">Publish Now</button>
      <button type="submit" name="action" value="draft" class="secondary">Update Draft</button>
      <a href="/admin"><button type="button" class="secondary">Cancel</button></a>
    `;
  } else {
    // Editing a published note
    buttons = `
      <button type="submit">Update Note</button>
      <a href="/admin"><button type="button" class="secondary">Cancel</button></a>
    `;
  }

  const scheduleStyles = isDraft ? `
    .schedule-section {
      background: #f0f0e8;
      padding: 16px;
      border-radius: 4px;
      margin-bottom: 20px;
    }
    .schedule-status {
      color: #2e7d32;
      margin-bottom: 12px;
      font-size: 14px;
    }
    .schedule-inputs {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
    }
    .schedule-btn {
      background: #2e7d32;
    }
    .schedule-btn:hover {
      background: #1b5e20;
    }
    @media (max-width: 480px) {
      .schedule-inputs { flex-direction: column; align-items: stretch; }
      .schedule-inputs input { width: 100%; }
    }
  ` : '';

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
      ${scheduleSection}
      <div class="btn-group">
        ${buttons}
      </div>
    </form>
  `;

  return htmlTemplate(title, content, { extraStyles: ADMIN_STYLES + scheduleStyles, noIndex: true });
}

export function renderDraftEditor(draft: Draft): string {
  return renderNoteEditor(draft as unknown as Note, true, draft);
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

  return htmlTemplate(`Delete #${note.id}`, content, { extraStyles: ADMIN_STYLES, noIndex: true });
}

export function renderDraftDeleteConfirm(draft: Draft): string {
  const content = `
    <h1 style="${TITLE_FONT} font-size: 24px; margin-bottom: 32px;">Delete Draft</h1>
    <p style="margin-bottom: 24px;">Are you sure you want to delete the draft <strong>${escapeHtml(draft.title) || '(untitled)'}</strong>?</p>
    <form method="POST" action="/admin/draft/${draft.id}/delete">
      <div class="btn-group">
        <button type="submit" class="danger">Delete</button>
        <a href="/admin"><button type="button" class="secondary">Cancel</button></a>
      </div>
    </form>
  `;

  return htmlTemplate('Delete Draft', content, { extraStyles: ADMIN_STYLES, noIndex: true });
}

export function renderIndexPage(notes: NoteMeta[]): string {
  const extraStyles = `
    .page-header { display: flex; justify-content: space-between; align-items: center; font-size: 14px; color: #666; margin-bottom: 32px; }
    .page-header a { color: #666; text-decoration: none; }
    .page-header a:hover { opacity: 0.7; }
    .note-list { list-style: none; }
    .note-item { display: flex; align-items: flex-start; gap: 16px; margin-bottom: 20px; }
    .note-item-meta { font-size: 14px; color: #666; flex-shrink: 0; width: 48px; line-height: 1.3; }
    .note-item-content { flex: 1; min-width: 0; }
    .note-item-title { ${TITLE_FONT} font-size: 18px; margin-bottom: 2px; line-height: 1.3; }
    .note-item-title a { color: #1a1a1a; text-decoration: none; }
    .note-item-title a:hover { opacity: 0.7; }
    .note-item-excerpt { font-size: 16px; color: #666; line-height: 1.7; margin: 0; }
    .page-footer { display: flex; justify-content: center; gap: 16px; font-size: 14px; margin-top: 48px; }
    .page-footer a { color: #666; text-decoration: none; }
    .page-footer a:hover { opacity: 0.7; }
    .empty-state { text-align: center; color: #666; }
    .empty-state a { color: #666; }
  `;

  const description = 'Short reflections and observations by Philipp D. Dubach.';

  const header = `
    <header class="page-header">
      <span>All Notes</span>
      <a href="https://philippdubach.com/posts/notes-the-space-between/">about</a>
    </header>
  `;

  if (notes.length === 0) {
    const content = `
      ${header}
      <section class="empty-state">
        <p>No notes yet.</p>
        <p style="margin-top: 24px;"><a href="/">← back to home</a></p>
      </section>
    `;
    return htmlTemplate('All Notes', content, { extraStyles, description });
  }

  const items = notes.map((meta) => `
    <article class="note-item">
      <div class="note-item-meta">#${meta.id}</div>
      <div class="note-item-content">
        <h2 class="note-item-title"><a href="/${meta.id}">${escapeHtml(meta.title)}</a></h2>
        <p class="note-item-excerpt">${escapeHtml(meta.excerpt || '')}</p>
      </div>
    </article>
  `).join('');

  const footer = `
    <nav class="page-footer" aria-label="Page navigation">
      <a href="javascript:history.back()">‹ back</a>
      <a href="/feed.xml">RSS</a>
    </nav>
  `;

  const content = `
    ${header}
    <section aria-label="Notes list">${items}</section>
    ${footer}
  `;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: 'Notes by Philipp D. Dubach',
    description,
    url: 'https://notes.philippdubach.com/all',
    author: {
      '@type': 'Person',
      name: 'Philipp D. Dubach',
      url: 'https://philippdubach.com',
    },
  };

  return htmlTemplate('All Notes', content, { extraStyles, description, jsonLd });
}
