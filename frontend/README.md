# Future You: front end

Next.js 16 + React + Tailwind + Recharts. See the [main README](../README.md) for how to run the whole app.

- `src/components/`: phone screens, voice session (`voice/`), saved answers, math sheet, activity panel
- `src/lib/api.ts`: typed client; `src/lib/api-schema.ts` is generated from the back end (`npm run gen:types` at the repo root)
- `src/lib/store.ts` + `src/lib/actions.ts`: app state and the actions the screens and the voice agent share
- `src/app/`: the app (`/`), `/checklist`, `/grounding`, `/voice-lab`, `/dev`, and the server-only `/api/voice/signed-url` route
