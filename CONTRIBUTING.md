# Contributing to Gantry

## TDD discipline

This project follows test-driven development. Every change goes through red → green → refactor.

### Hard rules

1. **Red first for bugs.** Reproduce with a failing test before fixing.
2. **One test at a time.** Don't batch N tests then implement.
3. **Never `--no-verify`, never `.skip`/`xfail` to bypass failures.** Fix or revert.
4. **No commits to `main`.** Branch + PR only. Conventional commits (`test:`, `feat:`, `fix:`, `refactor:`, `chore:`).
5. **No deleting tests to make green.** Tests are removed only when behavior is intentionally removed.
6. **Coverage never decreases on PR.** Floor ratchets up.

### Test tiers

| Tier | Purpose | Where |
|------|---------|-------|
| 1 — Pure | Unit tests, no I/O. vitest + supertest + @testing-library/svelte | Pre-commit hook + always |
| 2 — Docker integration | Real Docker, real SQLite. Disposable containers labeled `gantry.test=1` | Pre-push hook + always |
| 3 — E2E | Playwright over full stack | Manual `npm run e2e` |

CI on Gitea is **not yet enabled** (no runner registered to repo).

## Commands

```bash
# Backend
cd backend
npm test                   # Tier 1 + Tier 2
npm run test:watch
npm run test:unit          # Tier 1 only
npm run test:integration   # Tier 2 only
npm run test:coverage      # report at backend/coverage/index.html

# Frontend
cd frontend
npm test
npm run test:watch
npm run test:coverage      # report at frontend/coverage/index.html

# Root (runs both)
npm run test:backend
npm run test:frontend
```

## First-time setup

Node 20 is the recommended baseline (matches the Dockerfile target). `.nvmrc` is checked in. Newer Node (22, 24, 25) also works since `better-sqlite3@^12` supports `20.x || 22.x || 23.x || 24.x || 25.x`.

```bash
nvm use         # or `fnm use` — optional, only if your default Node is outside the supported range
npm install                   # root: husky + lint-staged
npm --prefix backend install
npm --prefix frontend install
```

`npm install` at the root runs `husky` via the `prepare` script and registers `.husky/pre-commit` + `.husky/pre-push`.

## Hooks

- **pre-commit** — `lint-staged` runs `vitest related --run` on staged files (Tier 1 only). Fast.
- **pre-push** — Tier 2 integration tests if any exist and Docker socket is available. Skipped otherwise with a printed notice.

## Test fixtures

- `backend/tests/helpers/docker.js` — `createTestContainer(docker, opts)` spawns labeled containers, `cleanupAllTestContainers()` reaps any leftovers from crashed runs. Use `alpine` + `sleep infinity` for long-lived; `nginx:alpine` for HTTP target tests.
- `backend/tests/helpers/db.js` — `withTestDb(fn)` runs `fn` with a temp `DB_PATH` set, cleaned up after.

## Backfill order

1. Pure helpers — `caddy-client.buildConfig`, `docker-watcher.{sanitizeName,pickPort}`, `stats-manager.computeStats`
2. DB layer — `db.js`
3. Read-only API — `analytics`, `docker-analytics`, `networks`
4. Mutating API — `routes`, `images`, `volumes`
5. Docker integration — `docker-watcher` sync, `containers` API non-streaming, `stats-recorder`
6. Streams — `log-tail`, `containers` SSE logs, `index.js` WS routing
7. Frontend — `lib/api.js`, `lib/ws.js`, components
8. E2E — Playwright happy path

One PR per file. One Gitea issue per file with checklist of cases.

## Tier 3 — Playwright e2e / phone-viewport audit

`frontend/e2e/mobile.spec.js` loads every page at iPhone 14 / Pixel 7 (portrait + landscape)
and a 1280px desktop, asserts there is no horizontal overflow and that tap targets are big
enough, and saves screenshots to `frontend/e2e/shots/<project>/` (gitignored).

```bash
cd frontend && npm run dev            # or: docker compose up -d --build (prod image)
cd frontend && npm run e2e            # default BASE_URL=http://localhost:5173
BASE_URL=http://gantry.localhost npm run e2e      # against the deployed stack
npm run e2e:mobile                    # portrait projects only
```

Nothing is started for you — point `BASE_URL` at whatever is running. Only Chromium is
used (iPhone presets are forced off WebKit); check Safari-specific behaviour on a real device.
