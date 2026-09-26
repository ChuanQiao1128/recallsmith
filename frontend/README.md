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

## Deployment

`./deploy.sh` is the whole deploy as one command: it runs `npm run build`, syncs
the hashed assets under `dist/` to the console bucket as immutable
(`public,max-age=31536000,immutable`), uploads `dist/index.html` last with
`no-cache`, invalidates the CloudFront distribution, then reads `index.html` back
from the live URL and compares its hash against the built one. Knobs, all read
from the environment: `DRY_RUN=1` builds and prints the commands without touching
AWS; `AWS_PROFILE` (default `dev`) picks the credentials; `CONSOLE_BUCKET` and
`CONSOLE_DISTRIBUTION_ID` override the bucket and distribution defaults.

The sync keeps old chunks on purpose — it no longer deletes what is not in the
new build. A tab opened before a deploy still points at the previous
`index.html`, and its next navigation asks for a hashed chunk from that older
build; because CloudFront rewrites a missing object to `index.html` (200), a
deleted chunk would come back as HTML and break the lazy import instead of
loading. Leaving the old assets in place lets those open tabs finish loading
until they reload.

### Pruning old assets

Because nothing is deleted on deploy, `assets/` grows over time and must be
pruned by hand. Delete only keys under `assets/` whose `LastModified` is **older
than 7 days** *and* that are **not** in the current build's `dist/assets/`.
`aws s3 sync` only re-uploads files whose size or timestamp changed, so an
unchanged chunk keeps its original `LastModified` while the live `index.html`
still references it — age alone is not enough, or the prune would delete a live
file.

The read-first procedure (fill in the ISO date for 7 days ago):

```sh
# 1. List candidate keys: everything under assets/ older than 7 days.
aws s3api list-objects-v2 --bucket "$CONSOLE_BUCKET" --prefix assets/ \
  --query "Contents[?LastModified<='2026-09-20T00:00:00Z'].Key" --output text \
  | tr '\t' '\n' > /tmp/prune-candidates.txt

# 2. Remove from that list every name present in the build that is live now.
for f in $(ls dist/assets); do
  grep -v -- "$f" /tmp/prune-candidates.txt > /tmp/prune-keep.txt \
    && mv /tmp/prune-keep.txt /tmp/prune-candidates.txt
done

# 3. Review the remaining list, then delete each key by hand.
cat /tmp/prune-candidates.txt
while read -r key; do aws s3 rm "s3://$CONSOLE_BUCKET/$key"; done < /tmp/prune-candidates.txt
```

Run this by hand at most monthly, after a deploy, never from `deploy.sh`.
