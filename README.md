# Future You (Two Futures)

A 360° Financial Health Navigator built for PNC's HackUTD challenge. See your whole money picture today, talk to two versions of yourself in 2031, and take the first step of a better plan in one tap.

- Plan: [docs/PRD.txt](docs/PRD.txt)
- Build order: [MILESTONES.md](MILESTONES.md)

## Layout

| Folder | What it is |
|---|---|
| `backend/` | FastAPI + NumPy. `app/models.py` is the API contract; `app/main.py` holds the routes. |
| `backend/app/fixtures/` | Placeholder JSON served by the stub endpoints until the engine lands (M2–M5). Built by `scripts/make_fixtures.py`. |
| `frontend/` | Next.js 16 + React + Tailwind + Recharts. `src/lib/api.ts` is the typed client. |
| `agent/` | ElevenLabs agent prompt and setup (M8). |
| `data/` | Generated demo customers (M2). |

## Run it

Needs Node 22+ and [uv](https://docs.astral.sh/uv/).

```bash
npm run setup
```

```bash
npm run dev
```

The web app runs at http://localhost:3000 and the API at http://localhost:8000 (docs at `/docs`). The browser only calls Next, which forwards `/api/*` to FastAPI. Open http://localhost:3000/dev to see every endpoint's response.

## Everyday commands

| Command | What it does |
|---|---|
| `npm run check` | Backend tests, front-end type check and lint |
| `npm run fixtures` | Rebuild fixture JSON (validated against the models) |
| `npm run gen:types` | After changing `backend/app/models.py`: export OpenAPI and regenerate `frontend/src/lib/api-schema.ts` |

## The contract rules

1. Every number a user sees is a `Metric` carrying its own `math` (for "show the math") and a stable `id` (for `highlight_metric`).
2. Money is in today's dollars, dates are `YYYY-MM-DD`, and the demo's "today" is fixed at 2026-11-08.
3. `start_transfer` refuses anything without `confirmed: true`. Nothing moves without a clear yes.
