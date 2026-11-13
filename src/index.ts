const API_V1_PREFIX = '/v1';

/**
 * Routes on the patrons Worker, keyed by their path under {@link API_V1_PREFIX}
 */
const PATRONS_ROUTES: Record<string, string> = {
	'/patrons': '/api/v1/patrons',
	'/special-thanks': '/api/v1/special-thanks',
};

const AUTOEQ_PROFILES_PREFIX = '/autoeq/profiles/';

/**
 * Profile IDs are `<source>/<rig directory>/<name>`, each slugified by AutoEq-TS-SDK
 */
const AUTOEQ_PROFILE_PATTERN = /^[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+\.json$/;

/**
 * Profiles are refreshed from AutoEq weekly, so they're cached for a day rather than forever
 */
const AUTOEQ_CACHE_CONTROL = 'public, max-age=86400';

/**
 * Everything served here is public, so any origin can read it
 */
const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*' };

function json(body: unknown, init?: ResponseInit): Response {
	return new Response(JSON.stringify(body), {
		...init,
		headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, ...init?.headers },
	});
}

function withCors(response: Response): Response {
	const headers = new Headers(response.headers);
	for (const [name, value] of Object.entries(CORS_HEADERS)) headers.set(name, value);
	return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/**
 * Forwards a request to the patrons Worker through its service binding
 */
async function proxyPatrons(request: Request, env: Env, path: string): Promise<Response> {
	const url = new URL(request.url);
	url.pathname = path;
	return withCors(await env.PATRONS.fetch(new Request(url, request)));
}

/**
 * Serves an AutoEq profile from R2, answering conditional requests with a 304
 */
async function getAutoEqProfile(request: Request, env: Env, id: string): Promise<Response> {
	if (!AUTOEQ_PROFILE_PATTERN.test(id)) {
		return json({ error: 'Not Found' }, { status: 404 });
	}

	const object = await env.AUTOEQ.get(`profiles/${id}`, { onlyIf: request.headers });
	if (!object) {
		return json({ error: 'Not Found' }, { status: 404 });
	}

	const headers = new Headers(CORS_HEADERS);
	object.writeHttpMetadata(headers);
	headers.set('Content-Type', 'application/json');
	headers.set('Cache-Control', AUTOEQ_CACHE_CONTROL);
	headers.set('ETag', object.httpEtag);

	// R2 returns the object without a body when the request's preconditions (e.g. If-None-Match) fail
	if (!('body' in object)) {
		return new Response(null, { status: 304, headers });
	}

	return new Response(request.method === 'HEAD' ? null : object.body, { headers });
}

async function handleApiV1(request: Request, env: Env, path: string): Promise<Response> {
	const patronsPath = PATRONS_ROUTES[path];
	if (patronsPath) {
		return proxyPatrons(request, env, patronsPath);
	}

	if (path.startsWith(AUTOEQ_PROFILES_PREFIX)) {
		return getAutoEqProfile(request, env, path.slice(AUTOEQ_PROFILES_PREFIX.length));
	}

	return json({ error: 'Not Found' }, { status: 404 });
}

export default {
	async fetch(request: Request, env: Env, __: ExecutionContext): Promise<Response> {
		if (request.method === 'OPTIONS') {
			return new Response(null, {
				status: 204,
				headers: { ...CORS_HEADERS, 'Access-Control-Allow-Methods': 'GET, HEAD', 'Access-Control-Max-Age': '86400' },
			});
		}

		if (request.method !== 'GET' && request.method !== 'HEAD') {
			return json({ error: 'Method Not Allowed' }, { status: 405, headers: { Allow: 'GET, HEAD' } });
		}

		const { pathname } = new URL(request.url);

		if (pathname.startsWith(`${API_V1_PREFIX}/`)) {
			return handleApiV1(request, env, pathname.slice(API_V1_PREFIX.length).replace(/\/+$/, ''));
		}

		return json({ error: 'Not Found' }, { status: 404 });
	},
} satisfies ExportedHandler<Env>;
