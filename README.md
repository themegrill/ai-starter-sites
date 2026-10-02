# tg-ai-site-generator

Backend for the Starter Templates "Build with AI" flow. A Next.js app whose API
routes take a site description from the WordPress plugin and return a
Generation Package (see `AI_STARTER_SITES_KB.md` §6 for the contract).

It currently runs in **mock mode**: responses come from fixtures in
`lib/fixtures/` (bakery, agency, fitness), no API keys needed.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Mode check: `{ ok, mode, model, tokenRequired }` |
| POST | `/api/generate` | Prompt -> Generation Package |
| POST | `/api/regenerate-section` | Rewrite one section's copy |
| POST | `/api/switch-demo` | Rebuild the package on another demo |
| GET | `/api/generate/:id/status` | Progress `{ step, progress }` |

Errors use `{ "error": { "code", "message", "retryAfter?" } }` with codes
`RATE_LIMITED` (429), `INVALID_INPUT` (400), `UNAUTHORIZED` (401) and
`GENERATION_FAILED` (500).

In mock mode, put `#ratelimit`, `#invalid`, `#unauthorized`, `#fail` or
`#badresponse` in the description to get that error back.

## Local development

```sh
pnpm install
cp .env.example .env.local
pnpm dev            # http://localhost:3000/api/health
```

## Deploying to Vercel (CLI, no Git needed)

```sh
npx vercel login    # once
npx vercel          # preview deploy; first run links/creates the project
npx vercel --prod   # production deploy
```

Then in the Vercel dashboard, Project -> Settings -> Environment Variables:

| Variable | Value |
|---|---|
| `MOCK` | `true` for now |
| `SITE_TOKENS` | A long random string (or several, comma-separated) |
| `ALLOWED_ORIGINS` | `*` while testing, later the real site origins |
| `GROQ_API_KEY` | Later, when the live pipeline lands |
| `PEXELS_API_KEY` | Later, for image search |

Env var changes only apply to new deployments, so run `npx vercel --prod`
again after editing them.

## Layout

```
app/api/...          Route handlers (thin: validate -> generator -> JSON)
lib/http.ts          CORS, X-Site-Token check, error shaping
lib/validate.ts      Request validation (limits match the plugin form)
lib/generator/       Generator interface; mock.ts now, live pipeline next
lib/fixtures/        Fixture packages, shared shape with the plugin mock
lib/types.ts         Contract types (copy of the plugin's ai/types.ts)
```
