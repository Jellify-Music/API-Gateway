import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';

const PROFILE_ID = 'oratory1990/over-ear/sennheiser-hd-650';
const PROFILE = {
	preamp: -6.1,
	filters: [['LSC', 105, 6.4, 0.7]],
	fixedBand: { preamp: -7.4, gains: [7, 2.6, -1.2, -2.2, 0.5, -1, 0.7, -1.2, 5.1, -3.6] },
};

/** Records requests forwarded to the patrons Worker and answers with their path */
function createPatrons() {
	const requests: Request[] = [];
	const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const request = new Request(input, init);
		requests.push(request);
		return Response.json({ path: new URL(request.url).pathname }, { headers: { 'X-From': 'patrons' } });
	});
	return { binding: { fetch } as unknown as Fetcher, requests };
}

async function request(path: string, init?: RequestInit, patrons = createPatrons()) {
	const response = await worker.fetch(
		new Request(`https://api.jellify.app${path}`, init),
		{ ...env, PATRONS: patrons.binding },
		{} as ExecutionContext,
	);
	return { response, patrons };
}

beforeAll(async () => {
	await env.AUTOEQ.put(`profiles/${PROFILE_ID}.json`, JSON.stringify(PROFILE), { httpMetadata: { contentType: 'application/json' } });
});

describe('patrons routes', () => {
	it.each([
		['/v1/patrons', '/api/v1/patrons'],
		['/v1/special-thanks', '/api/v1/special-thanks'],
		['/v1/patrons/', '/api/v1/patrons'],
	])('forwards %s to %s on the patrons Worker', async (path, upstreamPath) => {
		const { response, patrons } = await request(path);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ path: upstreamPath });
		expect(response.headers.get('X-From')).toBe('patrons');
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
		expect(patrons.requests).toHaveLength(1);
		expect(patrons.requests[0]?.method).toBe('GET');
	});

	it('keeps the query string', async () => {
		const { patrons } = await request('/v1/patrons?refresh=1');
		expect(new URL(patrons.requests[0]!.url).search).toBe('?refresh=1');
	});
});

describe('AutoEq profiles', () => {
	it('serves a profile from R2', async () => {
		const { response } = await request(`/v1/autoeq/profiles/${PROFILE_ID}.json`);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual(PROFILE);
		expect(response.headers.get('Content-Type')).toBe('application/json');
		expect(response.headers.get('Cache-Control')).toBe('public, max-age=86400');
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
		expect(response.headers.get('ETag')).toBeTruthy();
	});

	it('answers a matching If-None-Match with a 304', async () => {
		const { response: first } = await request(`/v1/autoeq/profiles/${PROFILE_ID}.json`);
		const etag = first.headers.get('ETag')!;
		await first.body?.cancel();

		const { response } = await request(`/v1/autoeq/profiles/${PROFILE_ID}.json`, { headers: { 'If-None-Match': etag } });

		expect(response.status).toBe(304);
		expect(response.headers.get('ETag')).toBe(etag);
	});

	it('answers HEAD without a body', async () => {
		const { response } = await request(`/v1/autoeq/profiles/${PROFILE_ID}.json`, { method: 'HEAD' });

		expect(response.status).toBe(200);
		expect(response.body).toBeNull();
	});

	it.each([
		'/v1/autoeq/profiles/oratory1990/over-ear/missing.json',
		'/v1/autoeq/profiles/oratory1990/over-ear/sennheiser-hd-650',
		'/v1/autoeq/profiles/../secrets.json',
		'/v1/autoeq/profiles/Oratory1990/over-ear/sennheiser-hd-650.json',
	])('returns 404 for %s', async (path) => {
		const { response } = await request(path);
		expect(response.status).toBe(404);
	});
});

describe('routing', () => {
	it.each(['/', '/v1', '/v1/unknown', '/api/v1/patrons', '/v2/patrons'])('returns 404 for %s', async (path) => {
		const { response, patrons } = await request(path);

		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ error: 'Not Found' });
		expect(patrons.requests).toHaveLength(0);
	});

	it('rejects methods other than GET and HEAD', async () => {
		const { response, patrons } = await request('/v1/patrons', { method: 'POST' });

		expect(response.status).toBe(405);
		expect(response.headers.get('Allow')).toBe('GET, HEAD');
		expect(patrons.requests).toHaveLength(0);
	});

	it('answers CORS preflights', async () => {
		const { response } = await request('/v1/patrons', { method: 'OPTIONS' });

		expect(response.status).toBe(204);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
		expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, HEAD');
	});
});
