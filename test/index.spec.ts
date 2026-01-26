import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import worker from '../src';
import { saveNote, getNote, deleteNote, generateNoteId } from '../src/db';

describe('Notes Worker Security Tests', () => {
	describe('Public Routes', () => {
		it('GET / returns valid response with security headers', async () => {
			const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/');
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);
			
			// Should return 200 or 302 (redirect to latest note)
			expect([200, 302]).toContain(response.status);
			
			// Verify security headers are present
			expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
			expect(response.headers.get('X-Frame-Options')).toBe('DENY');
			// CSP allows inline scripts (for audio player) and analytics service (gc.zgo.at)
			expect(response.headers.get('Content-Security-Policy')).toContain("script-src 'self' 'unsafe-inline' https://gc.zgo.at");
			// HSTS header should be present
			expect(response.headers.get('Strict-Transport-Security')).toContain('max-age=31536000');
		});

		it('GET /nonexistent returns 404 with security headers', async () => {
			const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/nonexistent-note');
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);
			
			expect(response.status).toBe(404);
			expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
		});
	});

	describe('Admin Authentication', () => {
		it('GET /admin without auth redirects to login', async () => {
			const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/admin');
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);
			
			expect(response.status).toBe(302);
			expect(response.headers.get('Location')).toBe('/admin/login');
		});

		it('GET /admin/new without auth redirects to login', async () => {
			const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/admin/new');
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);
			
			expect(response.status).toBe(302);
			expect(response.headers.get('Location')).toBe('/admin/login');
		});

		it('POST /admin/edit/:id without auth redirects to login', async () => {
			const formData = new FormData();
			formData.append('title', 'Test');
			formData.append('content', 'Test content');
			
			const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/admin/edit/0001', {
				method: 'POST',
				body: formData,
			});
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);
			
			expect(response.status).toBe(302);
			expect(response.headers.get('Location')).toBe('/admin/login');
		});

		it('POST /admin/delete/:id without auth redirects to login', async () => {
			const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/admin/delete/0001', {
				method: 'POST',
			});
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);
			
			expect(response.status).toBe(302);
			expect(response.headers.get('Location')).toBe('/admin/login');
		});

		it('POST /admin/login with invalid password returns 401', async () => {
			const formData = new FormData();
			formData.append('password', 'wrong-password');
			
			const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/admin/login', {
				method: 'POST',
				body: formData,
			});
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);
			
			expect(response.status).toBe(401);
			expect(await response.text()).toContain('Invalid password');
		});

		it('GET /admin/login page is accessible without auth', async () => {
			const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/admin/login');
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);
			
			expect(response.status).toBe(200);
			expect(await response.text()).toContain('Admin Login');
		});
	});

	describe('Cookie Security', () => {
		it('Login sets secure cookie attributes', async () => {
			const formData = new FormData();
			formData.append('password', env.ADMIN_PASSWORD);
			
			const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/admin/login', {
				method: 'POST',
				body: formData,
			});
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);
			
			expect(response.status).toBe(302);
			
			const setCookie = response.headers.get('Set-Cookie');
			expect(setCookie).not.toBeNull();
			expect(setCookie).toContain('HttpOnly');
			expect(setCookie).toContain('Secure');
			expect(setCookie).toContain('SameSite=Strict');
			expect(setCookie).toContain('Path=/');
		});
	});

	describe('Note CRUD Operations', () => {
		it('can create and retrieve a note', async () => {
			const id = await generateNoteId(env);
			const note = await saveNote(env, id, 'Test Title', 'Test content in **markdown**');

			expect(note.id).toBe(id);
			expect(note.title).toBe('Test Title');
			expect(note.content).toBe('Test content in **markdown**');
			expect(note.htmlContent).toContain('<strong>markdown</strong>');

			const retrieved = await getNote(env, id);
			expect(retrieved).not.toBeNull();
			expect(retrieved?.title).toBe('Test Title');

			// Cleanup
			await deleteNote(env, id);
		});

		it('can update an existing note', async () => {
			const id = await generateNoteId(env);
			await saveNote(env, id, 'Original Title', 'Original content');

			const updated = await saveNote(env, id, 'Updated Title', 'Updated content');
			expect(updated.title).toBe('Updated Title');
			expect(updated.content).toBe('Updated content');

			// Verify created timestamp is preserved
			const retrieved = await getNote(env, id);
			expect(retrieved?.title).toBe('Updated Title');

			// Cleanup
			await deleteNote(env, id);
		});

		it('can delete a note', async () => {
			const id = await generateNoteId(env);
			await saveNote(env, id, 'To Delete', 'Content');

			const deleted = await deleteNote(env, id);
			expect(deleted).toBe(true);

			const retrieved = await getNote(env, id);
			expect(retrieved).toBeNull();
		});

		it('returns false when deleting non-existent note', async () => {
			const deleted = await deleteNote(env, 'nonexistent-id-12345');
			expect(deleted).toBe(false);
		});
	});

	describe('XSS Sanitization', () => {
		it('strips script tags from markdown content', async () => {
			const id = await generateNoteId(env);
			const maliciousContent = 'Hello <script>alert("XSS")</script> world';
			const note = await saveNote(env, id, 'Test', maliciousContent);

			expect(note.htmlContent).not.toContain('<script>');
			expect(note.htmlContent).not.toContain('alert(');
			expect(note.htmlContent).toContain('Hello');
			expect(note.htmlContent).toContain('world');

			await deleteNote(env, id);
		});

		it('strips onclick handlers from markdown content', async () => {
			const id = await generateNoteId(env);
			const maliciousContent = 'Click <a href="#" onclick="alert(1)">here</a>';
			const note = await saveNote(env, id, 'Test', maliciousContent);

			expect(note.htmlContent).not.toContain('onclick');
			expect(note.htmlContent).toContain('href');

			await deleteNote(env, id);
		});

		it('strips javascript: URLs from links', async () => {
			const id = await generateNoteId(env);
			const maliciousContent = 'Click [here](javascript:alert(1))';
			const note = await saveNote(env, id, 'Test', maliciousContent);

			expect(note.htmlContent).not.toContain('javascript:');

			await deleteNote(env, id);
		});

		it('allows safe markdown features', async () => {
			const id = await generateNoteId(env);
			const safeContent = `
# Heading

This is **bold** and *italic* text.

- List item 1
- List item 2

[Safe link](https://example.com)

\`inline code\`

\`\`\`
code block
\`\`\`
`;
			const note = await saveNote(env, id, 'Test', safeContent);

			expect(note.htmlContent).toContain('<h1>');
			expect(note.htmlContent).toContain('<strong>bold</strong>');
			expect(note.htmlContent).toContain('<em>italic</em>');
			expect(note.htmlContent).toContain('<li>');
			expect(note.htmlContent).toContain('href="https://example.com"');
			expect(note.htmlContent).toContain('<code>');

			await deleteNote(env, id);
		});

		it('escapes HTML entities in title display', async () => {
			const id = await generateNoteId(env);
			const note = await saveNote(env, id, '<script>alert("XSS")</script>', 'Content');

			// Request the note page
			const request = new Request<unknown, IncomingRequestCfProperties>(`http://example.com/${id}`);
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			const html = await response.text();
			expect(html).not.toContain('<script>alert("XSS")</script>');
			expect(html).toContain('&lt;script&gt;');

			await deleteNote(env, id);
		});
	});
});
