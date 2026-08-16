# RecallSmith admin console

The React admin console: authoring decks and cards, publishing them, and
administering users. It talks to the .NET Lambda backend in `src_C/` through
API Gateway. See the [root README](../README.md) for the rest of the system.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on port 5173 |
| `npm run build` | `tsc -b && vite build` — this is also the type-check step |
| `npm test` | `vitest run` |
| `npm run lint` | `eslint .` — 0 errors, 1 known warning |
| `npm run preview` | Serves an already-built `dist/` |

Two things about type-checking that are easy to get wrong here:

- `npx tsc --noEmit` is **not** a check. `tsconfig.json` is references-only with
  no `include`, so it checks zero files and exits 0 even with a real type error
  in `src/`. Use `npx tsc -b --force`.
- Plain `tsc -b` skips work when an incremental buildinfo is present. `--force`
  reproduces what CI does.

`tests/` is outside the `include` of every tsconfig, so the test files are not
type-checked at all — only ESLint and Vitest's transform read them.

## Environment

`.env.development` is committed, so `npm ci && npm run dev` runs with no
configuration step. Vite loads it automatically by filename, and the five values
in it are public by construction — a dev API Gateway URL, a Cognito app client
id, and localhost redirect/scope settings — all of which are visible in any
shipped browser bundle. No secret is stored in this repository.

| Variable | Purpose |
| --- | --- |
| `VITE_API_BASE` | Backend base URL. `VITE_API_BASE_URL` overrides it if set; with neither, requests go same-origin through the Vite dev proxy |
| `VITE_COGNITO_DOMAIN` | Cognito hosted-UI domain |
| `VITE_COGNITO_CLIENT_ID` | Cognito app client id |
| `VITE_COGNITO_REDIRECT_URI` | OAuth callback, `http://localhost:5173/auth/callback` |
| `VITE_COGNITO_LOGOUT_URI` | Where the hosted UI returns after sign-out |
| `VITE_COGNITO_SCOPES` | Requested OAuth scopes |

**The dev port is not negotiable.** The Cognito app client has
`http://localhost:5173/auth/callback` registered as its callback URL, so a dev
server on any other port gets through the login screen and then fails the
callback.

`src/api/contentManifest.ts` also reads `VITE_CONTENT_MANIFEST_URL` (falling back
to `VITE_MANIFEST_URL`). Neither is set in `.env.development`; that feature
reports a "not set" error until one is provided.
