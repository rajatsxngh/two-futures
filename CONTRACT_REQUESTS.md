# Contract requests

Things the screens lane needed that `backend/app/models.py` (or the fixtures) doesn't give yet. Each has a workaround in the front end, so nothing is blocked. The engine lane decides.

## From the screens lane (M6/M7 build half)

1. **Account balances aren't `Metric`s.** `Account.balance` is a bare float, so per-account numbers on Today have no `math` and no stable id. Workaround: the front end formats them itself and tags them `data-metric-id="account.<id>.balance"`. Ask: add `balance_metric: Metric` to `Account` (id `account.<id>.balance`), or a `metrics` list on `ProfileResponse`.

2. **Forecast numbers outside `overdraft_risk_90d` aren't `Metric`s.** The "typical balance in a year" headline and each account's 12-month end balance are computed in the browser from `cash_series` / `accounts[].points`. Workaround ids: `forecast.cash.p50_end`, `forecast.account.<id>.end`. Ask: add `ForecastResponse.headline: list[Metric]` (e.g. typical end balance, range) and an `end` `Metric` per `AccountForecast`, so "show the math" (M9) works on them.

3. **Household only has a profile fixture.** `/api/health`, `/api/forecast` and `/api/futures` for `household` fall back to Maya's fixtures, so the household Today shows Maya's score. Fine for now (the switcher exists to show all 8 account types); M2–M4 should return real household data.

4. **Next step amount isn't a `Metric`.** `NextStep.amount` is a float; the $150 on the Next step card has no `math`. Ask: add `amount_metric: Metric` (id `next_step.amount`) explaining "largest $25 step that keeps bad-case checking above $200".

5. **Fixture mismatch (FYI, engine will replace it):** in `maya_update_plan.json` the plan key number says the car is paid off Jun 2028, but the plan events still say "Car paid off early" in Sep 2028.
