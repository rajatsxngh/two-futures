# Future You / Two Futures: Build Milestones

Source plan: [docs/PRD.txt](docs/PRD.txt)

**How this is ordered.** Each milestone depends only on milestones before it, never on later ones. The rule from the PRD shapes the order: *code does the math, AI does the talking*. So the engine comes first, then the screens that show its numbers, then the voice agent that talks about those numbers, and last the layers that build trust, harden the demo and ship it.

There are **12 milestones**. M1–M8 are the P0 core. When M8 is done, the main demo story runs end to end. M9–M11 add the P1 "win layer" and make the demo safe to run. M12 is shipping, plus P2 work only if there's spare time.

```
M1 Foundation ─► M2 Data ─► M3 Health score ─► M4 Forecast + futures ─► M5 What-if + actions API
                                    │                    │                        │
                                    └────────► M6 Today + Forecast screens ◄──────┘ (M6 needs M3, M4)
                                                         │
                                               M7 Two Futures + What-if + Next step UI  (needs M5, M6)
                                                         │
                                               M8 Voice agent  ── P0 COMPLETE ──
                                                         │
                                               M9 Trust layer ─► M10 Demo safety net ─► M11 P1 depth ─► M12 Ship
```

> **Parallel work:** see [Parallel waves](#parallel-waves) at the end. Short version: after M1, engine, screens and voice can be built at the same time. Connecting them to each other still has to happen in order.
>
> **Devpost is time-gated, not milestone-gated:** submit a rough Devpost page as soon as M7 works (target 9:00 PM Saturday in the PRD's timeline). Don't wait for M12.

---

## M1: Foundation and contracts ✅ done
**Depends on:** nothing
**Goal:** one repo where front end and back end run together, and everyone agrees on the data shapes before any logic is written.

- Repo layout: `backend/` (FastAPI + NumPy), `frontend/` (Next.js + React + Tailwind + Recharts), `data/` (customer JSON), `agent/` (prompt and setup files), `docs/`.
- Pydantic models for the whole data model: Customer, Account (all 8 types), Transaction, Bill, Plan, WhatIf, PathResult, FactSheet. Matching TypeScript types on the front end.
- Every endpoint stubbed to return fixture JSON: `GET /api/profile`, `/api/health`, `/api/forecast`, `/api/futures`, `POST /api/update_plan`, `/api/start_transfer`, `/api/reset`.
- Each response that carries a number also carries its **math** (inputs, formula in plain words, assumptions). Putting this in the contract now is what makes M9 ("show the math") cheap later.
- Env setup: API keys stay server-side (`.env`, never sent to the browser). One command starts both apps.

**Done when:** `frontend` fetches each stub endpoint and renders its raw JSON; the shapes match the PRD's data model.

---

## M2: Demo customers and data generator ✅ done
**Depends on:** M1
**Goal:** realistic, made-up data that every later number comes from.

- A generator script writing JSON for **Maya** (6 accounts: Spend checking, Reserve savings, CD maturing Apr 2027, IRA, auto loan $14,000, credit card 78% of $5,000) and **Jordan & Priya** (adds a mortgage and a personal loan, so all 8 account types exist).
- Maya's facts: $4,200/month take-home, biweekly pay, rent $1,450, ~$300/month saving ($100 of it to her IRA), about 1 month of cushion, 0 late payments, setup answers (3 of 4 insurance types, planning "sometimes").
- 12 months of transaction history per customer with categories and repeat flags, plus the bills list (rent, car, card, insurance, subscriptions, yearly bills, CD maturity).
- `GET /api/profile` serves real data, with accounts grouped (cash, savings and CDs, retirement, debt) and the two-sentence summary built from a template.

**Done when:** `/api/profile?customer=maya` and `?customer=household` return valid data; a test confirms the household covers all 8 account types.

---

## M3: Health score engine (F2 backend) ✅ done
**Depends on:** M2
**Goal:** the 0–100 Financial Health Score from 8 indicators, aligned with the FinHealth framework.

- 8 indicator functions, each scoring linearly between its two thresholds (from the PRD table): spending vs. income, bills on time, savings cushion, long-term saving, debt load, credit health, insurance, planning ahead.
- Pillars = average of 2 indicators (rounded half up); score = average of 4 pillars; bands 0–39 vulnerable, 40–79 coping, 80–100 healthy.
- Each indicator returns: value, score, status (red/amber/green), a plain reason, and its math.
- `GET /api/health` is live.
- The scoring function takes a "financial state" input, not a customer file, so M4 can score future years with it.

**Done when:** unit tests pass for every indicator, and Maya returns **47 / 100 / 20 / 24 / 90 / 20 / 75 / 60 → pillars 74 / 22 / 55 / 68 → score 55 (coping)**.

---

## M4: Forecast, two futures and plan rules (F3, F4 backend) ✅ done
**Depends on:** M3 (each future year is scored with the health engine)
**Goal:** every balance and bill for the next 12 months, plus two 5-year paths to 2031.

- **Calendar:** biweekly paychecks, every bill on its due rule, CD maturity.
- **12-month Monte Carlo:** 1,000 runs; categories vary by their past spread; 10%/month chance of a $300–$2,000 surprise. Output: daily median plus a P10–P90 band, a 90-day bills list, and the risk that checking drops below $0.
- **Plan rules** (fixed order, no AI): rule 1 is a payday transfer (largest $25 step that keeps bad-case checking above $200, which is **$150** for Maya), then windfall split, subscriptions, card → car loan snowball, then 6-month cushion → IRA. The next step is the first rule that can be automated.
- **Two 5-year paths** (same path vs. plan) with monthly steps, interest, and loan schedules. IRA growth is 5/2/8%. **Both paths share the same random seed and the same 2028 $2,000 car repair.** Yearly snapshots hold balances, payoff dates, cushion months, the 8 indicators and the score, all in today's dollars.
- **Fact sheets:** a short text for each path (today's facts, 2031 facts, plan summary, next step, opening line), with no raw transactions.
- `GET /api/forecast` and `GET /api/futures` are live. A fixed seed makes demo runs repeatable.

**Done when:** tests confirm the $150 transfer, that both paths contain the 2028 repair, and that forecast totals reconcile; one call to `/api/futures` finishes in under 1 second.

> **As built:** $150 comes from rule 1 with the plan trimming flexible spending by 20% (at 15% it would be $125). Rule 4 is "once the cushion hits 3 months, the transfer pays debt, highest rate first", and paid-off payments join the transfer. Maya in 2031: same path score 73, 4.6-month cushion, $3,900 card, ~$4,950 card interest paid; plan score 92, 5.9 months, $0 card. The 2028 repair comes out of savings on both paths (her existing $200/month habit covers it), so the fact sheets don't say it went on the card.

---

## M5: What-if and actions API (F6, F7 backend) ✅ done
**Depends on:** M4 (a what-if re-runs the plan path)
**Goal:** change a decision and get new numbers back, plus a simulated transfer and a demo reset.

- `POST /api/update_plan` covers raise or pay cut (×(1 − 22% − 7.65%) ÷ 12, no Texas state tax), spending change, savings change, one-time cost (savings first, then card), and job loss (income $0 for N months). It applies to the **plan path only**.
- Each result returns the new numbers, the change from before, and **one template sentence**. Austin example: +$8,000/yr → +$469/mo, rent +$300 → "about $170 more a month after taxes and the higher rent".
- `POST /api/start_transfer` returns status "Scheduled" with the first payday date and stores the transfer in demo state. `POST /api/reset` restores the starting state.
- Server-side session state, so what-ifs stack and reset clears them.

**Done when:** each of the 5 presets has a test; the Austin case returns about +$170/mo; reset puts Maya back to 55; a recalculation takes under 1 second.

> **As built:** what-ifs stack on the plan path and `GET /api/futures` reflects them until reset. "Save more" also lowers spending by the same amount, since moving money between your own accounts creates none. Job loss pauses plan transfers while there's no pay. Buy-a-home returns 422 until M11. Transfers are de-duplicated, so a retried "yes" doesn't schedule twice. A what-if takes about 0.45 s.

---

## M6: Today and Forecast screens (F1, F2, F3 UI) ✅ done
**Depends on:** M3, M4 (and M1's contracts)
**Goal:** the first two screens judges see, on real engine data.

- Phone frame in the middle of the laptop screen, with space for the activity panel on the right (left empty until M9). Design tokens: orange accent, navy text, white background, one sans-serif family, numbers at 32–48 px.
- **Today:** greeting, two-sentence summary, score ring (55, coping) with Spend/Save/Borrow/Plan bars, a drill-down into 8 indicator tiles (status color plus icon), grouped accounts, a "next 90 days" bills strip, and a big "Meet 2031" button.
- **Forecast:** 12-month chart (median line, shaded good-to-bad band, markers for rent, car, card due date and CD), account on/off toggles, the per-account list, and a "forecast, not a promise" label.
- A customer switcher (Maya / household) so all 8 account types can be shown.

**Done when:** both screens load in under 2 seconds from the live API, show Maya's 55 with the red card-usage tile, and render the household's mortgage and personal loan.

---

## M7: Two Futures, what-if drawer and next step (F4, F6, F7 UI) ✅ done
**Depends on:** M5, M6
**Goal:** the whole demo story works **by tapping, with no voice**. This is the backbone the voice agent plugs into.

- **Two Futures:** a split screen at 2031 (same path in gray, plan in a warm color) with 4 numbers each (cushion, card debt, car paid-off date, IRA), a short life timeline with the shared 2028 repair, one illustrated avatar used on both sides, and a text input for each side.
- **What-if drawer:** chips (new job, move, big purchase, save more, job loss) and sliders (income, spending, savings). A results line such as "+$11k by 2031". Numbers count up or down when a change lands.
- **Next step:** one card ("Move $150 from Spend to savings every payday") showing its effect on score and cushion, then a confirm sheet (amount, accounts, frequency, first date), then a "Scheduled" badge pops in.
- Client-side functions `updatePlan()`, `startTransfer()` and `highlightMetric()` written as plain functions. M8 registers these same functions as the agent's client tools.

**Done when:** a teammate can run demo steps 2–7 (Today → Forecast → Two Futures → Austin what-if → schedule the $150 transfer) with only clicks and typing. **Submit the rough Devpost page at this point.**

---

## M8: Future You voice agent (F5) ── P0 complete · 🟡 wired, live voice untested (needs ElevenLabs key)
**Depends on:** M7 (client tools and screens), M4 (fact sheets)
**Goal:** talk out loud to either future self, with only engine numbers.

- One ElevenLabs agent, with `future-maya-system-prompt.txt` and `future-maya-setup.md` in `agent/`. It answers in 1–3 sentences, does no math, never guesses, says "I don't know that part", says it's an AI if asked, pushes no products, and points to 988 in a crisis.
- `@elevenlabs/react` session started with dynamic variables `path` (same_path | plan) plus that path's fact sheet. Tapping the other card ends the session and starts a new one. Same voice on both sides. Opening line: "Hey... it's me. Well, it's you, five years from now."
- Client tools: `update_plan` (plan path only, waits for the result), `start_transfer` (only after a clear yes, waits), `highlight_metric` (doesn't wait).
- Live captions always on, a big mic button with a waveform, mute used as push-to-talk, typing as a fallback in the same session, and an "Okay, let me think back..." filler while a tool runs.
- An "Ask both" button sends one typed question to each future in turn.

**Done when:** the persona starts in under 3 seconds; first word about 2 seconds after a question; the car question gets two different, grounded answers; the Austin what-if by voice updates the screen; "yes" schedules the transfer; the 10-question manual test list passes in a quiet room.

---

## M9: Trust layer (F9, F10, F11) ✅ done (voice-side events untested live)
**Depends on:** M8 (the activity panel shows agent tool calls), M1 (math fields in every response)
**Goal:** make PNC's "Trusted AI" theme something judges can see.

- **Show the math:** tap any number to open a sheet with its inputs, the formula in plain words, thresholds and assumptions. Works on the Today, Forecast, Futures and what-if numbers.
- **Agent activity panel:** a live list in plain words (listening → tool called with its inputs → result → number highlighted), with lines that expand and a "raw data" switch. Example line: "Checked: Austin job, +$300 rent → about +$170 a month".
- **Number highlight:** `highlight_metric` makes the matching tile glow.

**Done when:** every number on the main demo path opens its math, and every tool call during a voice run appears in the panel within a second.

---

## M10: Demo safety net and grounding tests (F8) ✅ done (live-agent grounding run needs keys)
**Depends on:** M9 (saved answers have to replay the panel and the highlights too)
**Goal:** the demo can't break on stage.

- One-click **Reset** (UI button → `/api/reset` → front-end state cleared → Maya at 55).
- **Saved answers mode:** recorded agent replies and tool results for the main demo path, played back offline (no internet, no ElevenLabs).
- **Text-only mode** switch.
- **Automatic grounding test** (P1 in the PRD, but cheap here): a script sends the 10 test questions in text mode and checks that every dollar amount and year in each answer appears in a fact sheet or tool result. It prints "N of 10 grounded".
- A pre-demo checklist page (reset, score shows 55, mic, hotspot, saved-answers switch, backup video tab).

**Done when:** the main path runs with Wi-Fi off; the grounding script shows 10 of 10; 5 full run-throughs finish with no crash or restart.

---

## M11: P1 depth: job loss, buy a home, setup questions (F12, F13, F14)
**Depends on:** M5 (engine), M7 (drawer), M8 (agent), M10 (each new path also needs saved answers and grounding tests)
**Goal:** more what-if depth, and mortgage coverage inside Maya's own story.

- **Job-loss shock:** "lose my job for 3 months" shows how many months the cushion lasts in **each** future, side by side.
- **Buy a home:** price, down payment and rate give a mortgage payment that replaces rent from the purchase month. It shows up in every number. Add a chip to the drawer.
- **Two setup questions** (insurance, planning ahead) asked in about 10 seconds, feeding indicators 7 and 8, pre-filled for the demo.
- Extend the agent prompt and test list for these cases.

**Done when:** both what-ifs work by voice and by tapping, stay grounded, and keep the 3-minute demo under 3:00.

---

## M12: Ship it (video, Devpost, repo) + P2 stretch
**Depends on:** M10 at minimum (M11 if it's finished)
**Goal:** a complete, honest submission and a rehearsed pitch.

- 2-minute public video following the PRD's shot list, with the two-futures moment in the first 40 seconds. Real app, real voice, captions, and the split screen as thumbnail.
- Devpost final text (name, tagline, sections, "10 of 10 grounded", built-with list), screenshots of working screens, every teammate added, tracks: PNC + MLH Best Use of ElevenLabs.
- README covering setup, architecture diagram and test results. Repo cleanup.
- 5 timed rehearsals under 3:00, plus the 90-second judge-table version and a drill of the 14 Q&A answers.
- **P2, only if ahead:** Spanish (F15), Plaid test connection (F16), Letter from 2031 card (F17), Andre with uneven income (F18).

**Done when:** everything on the submission checklist is ticked before the edit deadline.

---

## Parallel waves

**Honest summary:** the back end is a real chain (data → score → forecast → what-if). Each step uses the one before it, and they all live in the same engine code. Splitting it across people saves little time and causes merge trouble. What *can* run at the same time is the work around the engine: screens, voice and trust UI, built against M1's sample data. So parallel work saves real time, but it doesn't make the project 4× faster. Each milestone from M6 to M9 has two halves: a **build** half that can start early on sample data, and a **wire** half that has to wait for the real pieces.

### Wave 0: M1 alone
Nobody else should write code until the contracts (data models, endpoint shapes, math fields, fact-sheet format) are fixed. Everything parallel after this depends on them. Non-code work that fits here: create the ElevenLabs account, pick a voice, draft the Devpost page, storyboard the video, draw the avatar.

### Wave 1: three lanes at once (after M1)
| Lane | Work | Why it's safe to run in parallel |
|---|---|---|
| **A: Engine** (one owner) | M2 → M3 → M4 → M5, in order | Only the back end; its outputs must match M1's contracts |
| **B: Screens** | Build half of M6 + M7: Today, Forecast, Two Futures, what-if drawer, next step, running on sample JSON | Only the front end; uses the contract shapes, not the engine |
| **C: Voice** | Build half of M8: the agent's prompt and settings, test-question list, mic/captions/waveform part, switching sessions per path using a hand-written fact sheet | Uses the ElevenLabs dashboard plus its own new parts; touches no screen code |
| *D: Trust UI (optional)* | Build half of M9: the show-the-math sheet and activity panel parts on sample data; outline of the M10 grounding script | Small. With fewer than 4 people, fold it into B or C |

Inside Lane A, one split is real if a second engine person exists: the **12-month forecast** part of M4 doesn't need the health score, so it can run alongside M3. The **5-year paths** do need M3 and must wait.

### Wave 2: connecting the pieces, in order, everyone together
1. **M6/M7 wire:** swap sample data for the live API (needs M5). Fix any differences between the sample data and the real responses.
2. **M8 wire:** register `updatePlan` / `startTransfer` / `highlightMetric` as agent tools, and send real fact sheets.
3. **M9 wire:** feed the agent's tool calls into the activity panel and highlights.

These touch shared files (the app's state, the tool functions), so do them one at a time, not side by side. Meanwhile the engine owner can start the **M11 back end** (buy-a-home mortgage math, setup-question inputs), which only touches engine files.

### Wave 3: M10, then the rest of M11
M10 needs the whole app. The M11 screens and agent work wait for M10, because new paths also need saved answers and grounding tests.

### Wave 4: M12
The final recording needs the finished app. The Devpost text, README layout and Q&A practice can be drafted any time from Wave 0 on.

### What not to run in parallel
- **M1 with anything else.** Changing contracts after people have built on them costs more than waiting for M1.
- **M2–M5 split across people** (except the forecast split above).
- **Two people connecting pieces at the same time** in Wave 2.

### Practical requirement
Parallel coding (by teammates or by separate Claude sessions) needs **git**. This folder isn't a git repo yet. Each lane should work on its own branch, and branches should be merged at the Wave 2 points.

---

## Mapping back to the PRD

| Milestone | Features | PRD scope-ladder gate |
|---|---|---|
| M1–M4, M6 | F1–F3 (+ F4 data) | 7:00 PM Sat: score 55, forecast, both paths, Today on real data |
| M5, M7, M8 | F4–F7 | 11:00 PM Sat: Two Futures, voice, update_plan end to end, Devpost in |
| M9, M10 | F8–F11 | 2:00 AM Sun: feature freeze |
| M11 | F12–F14 | If time remains |
| M12 | F15–F18 + submission | Only if ahead / by 12:00 PM Sun |

Small difference from the PRD: F11 (number highlight) moves into M9 because it shares wiring with the activity panel, and the grounding script moves into M10 because the safety net is where it pays off.
