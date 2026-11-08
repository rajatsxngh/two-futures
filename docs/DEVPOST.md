# Devpost draft

Paste each section into the matching Devpost field. Everything here is true of the current build. Before submitting, check the line marked **[confirm]**.

**Event:** [HackUTD 2026: ZeroDay](https://hackutd-zeroday.devpost.com/). Team registration (first submit) by **11:00 PM Saturday 11/7**; final edits by **12:00 PM Sunday 11/8** (Dallas time).

**Tracks:** tick **PNC Track**. You may add up to two more sponsor tracks only if their challenge statement truly fits, plus one HackUTD track (the **Design Track** fits best). Every project is automatically in the General Track. There is **no ElevenLabs prize track** at this event, and none of the listed [MLH] tracks (Gemini, Solana, Tiger Data, Vultr, MongoDB Atlas, GoDaddy, SpaceXSI) fit this project, so don't claim them.

---

## Name

Two Futures

## Tagline

Meet the you of 2031, then take the first step today.

## Inspiration

More than a third of adults told the Fed they wouldn't cover a $400 surprise with cash, and most of them have a bank app. Bank apps explain what already happened. Most people don't know what to ask a chatbot, and the future feels like someone else's problem.

Research on future selves says that changes when the future feels real. In an MIT and UCLA study, people who met two future selves, one for each choice, reconsidered their decision about three times as often as the control group (34% vs 11%). PNC asked for a navigator that helps people see their whole picture, understand it, and feel confident about their next move. We built that around two future selves.

## What it does

- **See the whole picture:** every account in one view (checking, savings, CDs, IRAs, auto and personal loans, cards and mortgages), with a two-sentence summary.
- **Make sense of it:** a 0–100 Financial Health Score from 8 indicators aligned with the Financial Health Network's Spend, Save, Borrow and Plan framework, each with a plain reason and its math.
- **Forecast:** every balance and bill for 12 months from 1,000 simulations, with a good-to-bad range, plus 5-year paths to 2031.
- **Talk to your future:** two versions of you in 2031, one on the same path and one on a simple plan. Ask both the same question and hear two lives. Voice through ElevenLabs, or text.
- **Try a decision:** a new job, a move, a big purchase, saving more, losing your job, buying a home, by voice or by tap. The numbers and her story change.
- **Take the first step:** one next step ("Move $150 from Spend to savings every payday"), started with one tap, and only after a clear yes.

Our demo customer, Maya (27, a nurse in Dallas), scores 55 today. On the same path she reaches 2031 with her card still at $3,900 and about $4,954 paid in interest. With the plan, her card is at $0, her score is 92 and her IRA is about $24,100 instead of $15,700.

## How we built it

- **Engine (Python, NumPy, FastAPI):** health scoring from raw transactions; spending patterns learned from 12 months of history; a 1,000-run Monte Carlo forecast; fixed plan rules (no AI); and two 5-year paths that share the same random surprises and the same 2028 car repair, so only the decisions differ. What-ifs re-run the plan path in about half a second.
- **Every number shows its math:** the API returns each on-screen number with its formula, inputs, thresholds and assumptions. Tap any number to see it.
- **Voice (ElevenLabs Agents with `@elevenlabs/react`):** one agent plays both future selves. The app hands her a short fact sheet the engine wrote. She can only get new numbers through three client tools (`update_plan`, `start_transfer`, `highlight_metric`) that call our engine. A live activity panel shows every call in plain words.
- **Front end (Next.js, React, Tailwind, Recharts):** a phone-shaped app with the activity panel beside it, live captions, push-to-talk for loud rooms, and a typed fallback.
- **Demo safety net:** an offline "saved answers" agent that follows the same rules and reads the engine's numbers, a pre-demo checklist page, and one-click reset.

## Challenges we ran into

- **Keeping the AI honest with numbers.** Our rule is "code does the math, AI does the talking." The agent gets facts in and says words out; new numbers only come back from tools, with a ready-made sentence. We built an automatic grounding test that checks every dollar amount and year she says against what she was given.
- **Making the comparison fair.** Both futures get identical random surprises, so the plan wins on decisions, not luck. That also meant reporting results that didn't match our first story: Maya's existing savings habit covers the 2028 repair on both paths, so we tell that truthfully and let the card's interest make the point.
- **Voice in a loud hall:** push-to-talk, captions always on, a text mode, and an offline fallback.

## Accomplishments that we're proud of

- The two-futures format, running on real-looking accounts, ending in a real action.
- **10 of 10 grounded and 10 of 10 behaved** on our grounding test with the live ElevenLabs agent: every dollar amount and year she said was in her facts or a tool result.
- A health score computed from first principles: Maya's 55 comes out of her transactions, not a hard-coded number.
- 71 automated back-end tests, and a forecast whose every number can explain itself.

## What we learned

**[confirm: replace with the team's own honest paragraph.]** Suggested start: the hard part wasn't the voice, it was trust. People only believe a future self if every number she says can be checked, so we put the engine first and made the AI's job small and visible.

## What's next for Two Futures

- Linked accounts with customer consent instead of made-up data.
- A home inside PNC's coming digital assistant: Low Cash Mode covers the day a balance runs low, Two Futures covers the months ahead.
- More languages, starting with Spanish.
- A retention test like SaverLife's, and checking forecasts against what actually happened.

## Built with

Next.js, React, TypeScript, Tailwind CSS, Recharts, Python, FastAPI, NumPy, Pydantic, ElevenLabs Agents

---

## Screenshots to upload (real, working screens)

1. `docs/screenshots/4-two-futures.png`: two futures side by side (use as the thumbnail)
2. `docs/screenshots/5-talk-and-activity.png`: talking to the plan future, with the activity panel
3. `docs/screenshots/1-today.png`: today's whole picture and score
4. `docs/screenshots/2-indicators.png`: the 8 indicators
5. `docs/screenshots/3-forecast.png`: the 12-month forecast
6. `docs/screenshots/7-show-the-math.png`: why $150
7. `docs/screenshots/6-next-step-scheduled.png`: the scheduled first step
8. `docs/screenshots/8-job-loss-check.png`: job-loss check across both futures

## Submission checklist

- [ ] Devpost project submitted (aim for 9:00 PM Saturday; registration closes at 11:00 PM; a saved draft doesn't count)
- [ ] Every teammate added
- [ ] Tracks chosen: PNC Track (+ Design Track; other sponsor tracks only if they truly fit)
- [ ] Public demo video, 2 minutes or less (script: [DEMO_SCRIPT.md](DEMO_SCRIPT.md))
- [ ] Screenshots uploaded (list above)
- [ ] Public repo with the README
- [ ] Final edits before 12:00 PM Sunday
