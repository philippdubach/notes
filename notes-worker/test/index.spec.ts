import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import worker from '../src';

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
			expect(response.headers.get('Content-Security-Policy')).toContain("script-src 'none'");
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
});
