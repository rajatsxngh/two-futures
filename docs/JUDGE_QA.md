# Judge Q&A

Fourteen likely questions with short answers, updated to match the current build. Practice each until it comes out in one breath. Where a number appears, it's the engine's.

1. **How accurate is the forecast?** It's a range, not a promise. I simulate the year 1,000 times from her bills and spending patterns (made-up demo data); Maya's typical balance in a year is $1,375, with a range of $379 to $2,327. Tap any number for its assumptions. In production PNC would check forecasts against what actually happened.

2. **Isn't this just a chatbot?** The chat is the front door. Underneath, an engine scores 8 indicators, forecasts every account and builds two paths. She can change a number only by calling that engine, and the panel shows every call.

3. **How do you stop the AI making up numbers?** Her facts come only from an engine-written fact sheet, and new numbers only from tools that return a ready-made sentence. The prompt bans math and guessing. My grounding test checks every dollar amount and year she says: 10 of 10 with the live agent.

4. **Is this financial advice?** No. She shows options and trade-offs, never names a stock or fund, and sends bigger questions to a PNC banker. The one step she suggests is moving your own money to savings, and only after a clear yes and a tap on the confirm sheet. It's simulated: no real money moves.

5. **What data goes to the AI?** Only a short fact sheet: no raw transactions, no account numbers. The demo uses made-up data. In production: consent-based account linking and minimal data.

6. **How would PNC ship this?** As a feature of PNC's coming digital assistant, inside the new app. Low Cash Mode covers the day a balance runs low; this covers the months ahead.

7. **Isn't talking to "future you" a gimmick, or creepy?** In the MIT and UCLA study, 34% of people who met two future selves reconsidered their choice, against 11% in the control group. I skip aged faces and voice cloning on purpose, and she says she's an AI.

8. **Why voice?** It makes the future self feel real and helps people who avoid dashboards. Typing, captions and an offline mode always work too.

9. **Where does the $150 come from?** Plan rule 1: the largest $25 step per payday that keeps bad-case checking above $200 for the next year. With $150 her bad-case low is $438; $175 would dip below the floor. It assumes the plan trims flexible spending 20% (about $157 a month) and cancels an unused gym membership. Tap the $150 in the app to see it.

10. **Why isn't the same path worse?** Because I don't do scare tactics. Both paths get identical surprises, and if the same path's existing savings cover the 2028 repair, I say so. The difference that's real: a $3,900 card that never goes away and about $4,954 in interest, versus a paid-off card and a 92 score.

11. **What's in it for PNC?** More savings deposits (if 1% of about 8 million app users started a $150 transfer every two weeks, that's about $312 million a year; an illustration, not a forecast), more engagement, and an assistant built on trust.

12. **How did you measure financial health?** 8 indicators aligned with the Financial Health Network's Spend, Save, Borrow, Plan framework and its score bands, computed from account data. Each one shows its formula and thresholds in the app.

13. **What did you build, and what did you use?** I built the engine, scoring, plan rules, what-ifs, screens, tool layer, grounding test and offline agent. ElevenLabs provides speech and runs the live agent.

14. **What if someone is in crisis?** She stays kind, stops talking about money, and points to 988 and to people they trust. A launched version would add a hand-off to a person.

**Bonus, if they push on depth:**
- *What about a job loss?* The job-loss check: 3 months without pay in 2029 means the same path's savings cover 1.5 months, the card hits its $5,000 limit and about $4,700 of bills go unpaid. On the plan the card is already paid off, so nothing goes unpaid. A year without pay is shown honestly too: savings and the card run out and the unpaid bills are named, not hidden in a fake card balance.
- *Why build a cushion before paying a 25% card?* Only a small one: 2 months of spending, so the next surprise doesn't go straight back on the card. After that every dollar of the transfer attacks the card, which is gone by September 2028.
- *Can she handle a mortgage?* Yes: "buy a $250,000 home in June 2029 with 5% down" gives a $1,501 payment instead of $1,450 rent, and she'll tell you if you'd be short on the down payment.
