# Demo script

Every line below matches what the app actually shows or says today (engine numbers, saved-answers wording). With the live ElevenLabs agent her wording will vary, but her numbers come from the same fact sheets, so they match. Name each PNC bullet out loud as you hit it.

**Before you start:** open `/checklist` (every automatic check green, or Saved answers ready), press reset in the app header (score shows 55), backup video open in another tab, earbuds in.

---

## Stage version (3:00)

| Time | Screen | Do | Say |
|---|---|---|---|
| 0:00–0:15 | Title / Today | Nothing yet | "In the Fed's latest survey, more than a third of adults said they wouldn't cover a $400 surprise with cash. Most of them have a bank app. None of them can see their future. Meet Maya." |
| 0:15–0:40 | Today | Point at the summary, then the score; tap **See all 8 indicators**, point at the red Credit health tile | "Every account in one place: **the whole picture**. *'You're steady month to month, but you have about one month of backup.'* Her score is 55, coping, from **8 standard health indicators** aligned with the Financial Health Network. Her card at 78% of its limit is the biggest drag." |
| 0:40–0:55 | Forecast | Scroll the chart and bills | "**Every balance and every bill** for the next year: a typical balance of $1,375, with a range, because the future isn't one number. That's 1,000 simulations of her real spending patterns." |
| 0:55–1:15 | 2031 | Tap the **2031** tab | "Same Maya, same surprises, two paths. On the same path in 2031: score 73, the card still at $3,900. With a simple plan: score 92, card at $0, and $962 of card interest instead of $4,954." |
| 1:15–1:45 | 2031 → Ask both | Type **"Was buying the car worth it?"** in *Ask both* | Let both answer. Same path: *"The car itself? It's been paid off since April 2030… But that card never really went away: it's still at $3,900, and I've paid about $4,954 in interest on it."* Plan: *"Yes… The card's been at $0 since September 2028, and the car was paid off in August 2029, 8 months early."* (Live, her wording varies; the numbers don't. Ask both skips her greetings, so this takes about 20–30 seconds.) Then point at the panel: "**A conversational coach**, and **something new**: same question, two lives. Every number she says comes from my forecast. Here's what she checked." |
| 1:45–2:15 | Plan side | Ask: **"What if I take the Austin job? $8,000 more a year, but rent is $300 higher."** | The panel shows the `update_plan` call. She says: *"Taking the new job leaves about $170 more a month after taxes and the higher rent. By 2031, your cushion would be about 6.5 months instead of 5.9."* Say: "**The what-if simulator**, inside the conversation. The plan card just changed." |
| 2:15–2:35 | Plan side | She offers the transfer. Say **"Yes."** | The confirm sheet pops up. Tap **Yes, schedule it**: *"Done. $150 moves from Spend to Reserve every payday, starting Friday, November 13. This is a simulation: no real money moves."* Tap **Next step** to show the Scheduled badge. "**A confident next move**, in one tap, and nothing moves without a clear yes." |
| 2:35–3:00 | Next step | Tap the **$150** to open its math for two seconds | "Why $150? It's the largest $25 step that keeps her bad-case checking above $200. In a recent MIT and UCLA study, meeting two future selves made about three times as many people rethink a choice. I built that on real accounts, every number shows its math, and it's ready for PNC's assistant. Your bank app shows what happened. Two Futures shows what happens next." |

**Timing tips:** if a run goes past 3:00, cut the Forecast step to 10 seconds. Practice with a timer; aim for five clean runs.

## Judge-table version (90 seconds)

| Time | Show | Say |
|---|---|---|
| 0:00–0:15 | Today, score 55 | "Maya's whole picture and her health score in one screen." |
| 0:15–0:45 | Ask both the car question | "Same voice, two lives, and real numbers from her forecast." |
| 0:45–1:10 | Austin what-if on the plan side | "Try any decision out loud. Watch the numbers and her story change." |
| 1:10–1:20 | "Yes" to the $150 transfer | "From a feeling to an action in one tap." |
| 1:20–1:30 | Close | "Two Futures shows what happens next." Then invite the judge to ask her anything, or tap any number. |

**Extras for questions** (not on the main path):
- **Job-loss check** (2031 screen): "Lose your job for 3 months in 2029? On the same path her savings cover 1.5 months, the card hits its $5,000 limit and about $4,700 of bills go unpaid. With the plan, the card is already paid off, so it absorbs the gap and nothing goes unpaid."
- **Buy a home** (what-if drawer): "A $250,000 home in June 2029 with 5% down means a $1,501 payment instead of $1,450 rent, and she'd be about $5,200 short on the down payment, more than her card can take. It tells the truth, even when it's not what you want to hear."
- **Two quick questions** (Today): add disability insurance and her score goes from 55 to 58.

## If something fails

| What fails | Do this | Say |
|---|---|---|
| Voice or mic | Voice panel → **Text** | "Same agent, typed." |
| Internet or ElevenLabs | Voice panel → **Saved answers** (the main path runs offline) | Keep going. Same rules, same numbers. |
| Everything | Play the backup video | Take questions over it. |
| A wrong state on screen | Reset button (top right of the phone) | Back to 55 in one click. |

---

## Demo video (2:00 or less)

Record the real app. Use the live agent's voice if keys are in; otherwise saved answers with **Read answers aloud** on. Add captions. Use the two-futures screen as the thumbnail. Show only what actually works.

| Time | On screen | Voiceover |
|---|---|---|
| 0:00–0:10 | Title, then Maya's Today screen | "More than a third of adults wouldn't cover a $400 surprise with cash. Meet Maya." |
| 0:10–0:25 | Today, then the 8 indicators | "Her whole picture, and a health score of 55 from 8 standard indicators." |
| 0:25–0:35 | Forecast | "Every balance and bill for a year, with a range: 1,000 simulations." |
| 0:35–1:05 | 2031, Ask both the car question | The two answers play. "Same voice, two lives." |
| 1:05–1:30 | Austin what-if with the activity panel visible | "Try a decision out loud and watch the numbers change. Here's every number she checked." |
| 1:30–1:45 | "Yes", the tap, then the Scheduled badge | "From a feeling to an action, after a clear yes." |
| 1:45–2:00 | Tap the $150 to show its math, then the tagline | "Every number shows its math. Two Futures shows what happens next." |

**Recording tips:** browser at 1280×900 or wider so the activity panel shows. Reset before recording. Close other tabs so notifications don't pop up. The screenshots in `docs/screenshots/` show what each frame should look like.
