import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: {
				configPath: './wrangler.jsonc',
			},
			miniflare: {
				// The patrons Worker isn't available locally, so tests pass their own PATRONS binding
				serviceBindings: {
					PATRONS: () => new Response('PATRONS is stubbed in tests', { status: 501 }),
				},
			},
		}),
	],
	test: {
		include: ['test/**/*.spec.{ts,tsx}'],
	},
});
