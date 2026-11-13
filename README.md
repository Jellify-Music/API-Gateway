# API Gateway

Cloudflare Worker serving `api.jellify.app`: one versioned entry point for Jellify's public APIs. It routes each request to the service behind it, so those services can move without breaking App builds.

## Endpoints

| Method | Path | Served by |
| --- | --- | --- |
| `GET` | `/v1/patrons` | [Patrons Worker](https://github.com/Jellify-Music/Patreon-Campaign-List-Worker) `/api/v1/patrons`, through a service binding |
| `GET` | `/v1/special-thanks` | [Patrons Worker](https://github.com/Jellify-Music/Patreon-Campaign-List-Worker) `/api/v1/special-thanks`, through a service binding |
| `GET` | `/v1/autoeq/profiles/<id>.json` | The `jellify-autoeq` R2 bucket, uploaded by [AutoEq-TS-SDK](https://github.com/Jellify-Music/AutoEq-TS-SDK)'s publish workflow |

Every endpoint also answers `HEAD`, and every response allows any origin (CORS). AutoEq profiles are cached for a day and support `If-None-Match`.

## Bindings

| Binding | Type | Target |
| --- | --- | --- |
| `PATRONS` | Service | `supporters-list-function` |
| `AUTOEQ` | R2 bucket | `jellify-autoeq` |

## Development

```sh
bun install
bun run dev
bunx vitest run
bun run deploy
```

Run `bun run cf-typegen` after changing `wrangler.jsonc`.
