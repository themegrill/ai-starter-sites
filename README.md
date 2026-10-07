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
| POST | `/api/color-map` | `{ demoSlug, palette }` -> `{ colorMap }` for an edited palette |
| GET | `/api/generate/:id/status` | Progress `{ step, progress }` |

Errors use `{ "error": { "code", "message", "retryAfter?" } }` with codes
`RATE_LIMITED` (429), `INVALID_INPUT` (400), `UNAUTHORIZED` (401) and
`GENERATION_FAILED` (500).

In mock mode, put `#ratelimit`, `#invalid`, `#unauthorized`, `#fail` or
`#badresponse` in the description to get that error back.

## Demo colors

`pnpm manifests` groups each demo's colors into neutrals and brand hue
clusters. Only the **primary** and **secondary** clusters are recolored to the
brand palette (palette hue, saturation scaled relative to the cluster base,
demo lightness). **Accent** clusters and neutrals keep their demo values. The
mapping lives in `lib/colors.ts` and `lib/pipeline/color-map.ts` only; the
plugin asks `/api/color-map` for it.

Overrides per demo go in `data/demo-catalog.json` and win over the automatic
classification. A listed hex stands for its whole hue cluster, so its shades
follow:

```json
{
	"slug": "agency-03",
	"colors": {
		"lock": ["#ffb716"],
		"roles": { "#2563eb": "secondary" }
	}
}
```

- `lock`: keep these colors as designed (e.g. a bright CTA button).
- `roles`: force a cluster's role. `primary` or `secondary` remaps it,
  `accent` locks it.

Run `pnpm manifests` after editing; `REPORT.md` marks locked colors.

## Section fit

`pnpm manifests` groups each page's top-level blocks into **section groups**:
an intro block (heading and text) plus the body it introduces (pricing table,
gallery, team...), or a single block. Each group is `core` (hero, features,
content, testimonials, cta, contact, faq: always kept) or `conditional` with
the capabilities it needs (pricing → `pricing_plans`, gallery → `portfolio`,
team → `team`, logo strips → `client_logos`, counters → `stats`, blog cards →
`blog`, product/course listings → `products`).

At generation time the brief marks each capability true, false or unclear for
the business, and `lib/pipeline/sections.ts` drops a group when a capability it
needs is false, keeps it when all are true, and otherwise rewrites its copy to
fit. The hero and the last CTA are never dropped, and a page keeps at least
three groups. Dropped groups appear in the package as `pages[].removed`; the
plugin can restore them, and deletes the blocks of the rest on import
(`importPackage.pages[].removeBlocks`).

Override a group's fit in `data/demo-catalog.json` by its id (shown in
`REPORT.md`):

```json
"sectionFit": { "5b24aee6": { "kind": "core" } }
```

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
lib/colors.ts        Color math shared by the manifest build and the pipeline
```
