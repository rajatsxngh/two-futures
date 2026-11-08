"""Future You API.

Each route serves the real engine once its milestone lands and falls back to
fixture JSON (same shape) until then, or always when USE_FIXTURES=1.
"""

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

import logging

from . import config, connected, plaid_client
from .engine import actions
from .engine.data import MIN_BACKTEST_MONTHS, MIN_FORECAST_MONTHS, NotEnoughHistory, is_connected, require_history
from .engine.data import load as load_data
from .engine.plaid_adapter import AdapterError
from .engine.backtest import backtest_for
from .engine.forecast import forecast_for
from .engine.health import health_for
from .engine.profile import profile_for
from .engine.whatif import WhatIfError
from .fixtures import load
from .models import (
    BacktestResponse,
    ForecastResponse,
    FuturesResponse,
    HealthResponse,
    PlaidConnection,
    PlaidExchangeRequest,
    PlaidLinkTokenResponse,
    PlaidStatusResponse,
    ProfileResponse,
    ResetResponse,
    SetupRequest,
    ShockRequest,
    ShockResponse,
    StopTransferRequest,
    TransferRequest,
    TransferResponse,
    UpdatePlanResponse,
    WhatIfRequest,
)

app = FastAPI(
    title="Future You API",
    version="0.1.0",
    description="Engine and API for Future You (PNC 360° Financial Health Navigator).",
    separate_input_output_schemas=False,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _plain(err: dict) -> str:
    """One validation error in plain words, e.g. 'home.rate: must be 35 or less'."""
    loc = ".".join(str(x) for x in err.get("loc", ()) if x not in ("body", "query"))
    ctx = {k: (f"{v:,.0f}" if isinstance(v, float) and v.is_integer() else v) for k, v in (err.get("ctx") or {}).items()
           if isinstance(v, (int, float, str))}
    msg = {
        "less_than_equal": f"must be {ctx.get('le')} or less",
        "greater_than_equal": f"must be {ctx.get('ge')} or more",
        "greater_than": f"must be more than {ctx.get('gt')}",
        "multiple_of": f"must be a multiple of {ctx.get('multiple_of')}",
        "finite_number": "must be a real number (not NaN or infinity)",
        "bool_type": "must be exactly true or false",
        "missing": "is required",
    }.get(err.get("type", ""), err.get("msg", "is not valid"))
    return f"{loc}: {msg}" if loc else msg


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    # Plain-words detail, and never echo the input back (NaN/infinity can't be written as JSON).
    errors = exc.errors()
    detail = "; ".join(_plain(e) for e in errors) or "The request isn't valid."
    return JSONResponse(status_code=422, content={
        "detail": detail,
        "errors": [{"loc": [str(x) for x in e.get("loc", ())], "type": e.get("type"), "msg": e.get("msg")}
                   for e in errors],
    })


CustomerParam = Query("maya", max_length=40,
                      description="Customer id: 'maya', 'household', or 'sandbox' once a Plaid sandbox bank is connected")
log = logging.getLogger("two_futures")


def check_customer(customer: str) -> str:
    if customer not in config.CUSTOMERS and not is_connected(customer):
        raise HTTPException(status_code=404, detail="Unknown customer. (A sandbox bank must be connected first.)"
                            if customer == "sandbox" else "Unknown customer.")
    return customer


def need_history(customer: str, months: int, what: str) -> None:
    """Connected banks can send little history: say so plainly (422) instead of forecasting from too little."""
    try:
        require_history(customer, config.DEMO_TODAY, months, what)
    except NotEnoughHistory as e:
        raise HTTPException(status_code=422, detail=str(e)) from e


@app.get("/api/ping")
def ping() -> dict:
    return {"ok": True, "mode": "fixtures" if config.USE_FIXTURES else "engine", "today": config.DEMO_TODAY}


@app.get("/api/profile", response_model=ProfileResponse)
def get_profile(customer: str = CustomerParam):
    check_customer(customer)
    if config.USE_FIXTURES:
        return load(customer, "profile")
    data = actions.customer_data(customer)
    return profile_for(data, health_for(data, config.DEMO_TODAY), config.DEMO_TODAY)


@app.get("/api/health", response_model=HealthResponse)
def get_health(customer: str = CustomerParam):
    check_customer(customer)
    if config.USE_FIXTURES:
        return load(customer, "health")
    return health_for(actions.customer_data(customer), config.DEMO_TODAY)


@app.get("/api/forecast", response_model=ForecastResponse)
def get_forecast(customer: str = CustomerParam):
    check_customer(customer)
    if config.USE_FIXTURES:
        return load(customer, "forecast")
    need_history(customer, MIN_FORECAST_MONTHS, "the forecast")
    return forecast_for(customer, config.DEMO_TODAY)


@app.get("/api/backtest", response_model=BacktestResponse)
def get_backtest(customer: str = CustomerParam):
    """How good is the forecast? Re-run it on history with the last 91 days hidden, then score it on those days.
    Always computed by the engine (there's no fixture); cached after the first call."""
    check_customer(customer)
    need_history(customer, MIN_BACKTEST_MONTHS, "the backtest")
    res = backtest_for(customer, config.DEMO_TODAY)
    if is_connected(customer):  # the backtest's caveat describes our generator; say where this history came from
        checks = load_data(customer).data_checks
        caveat = ("Tested on Plaid sandbox test data. Its money doesn't run through checking the way the forecast "
                  "assumes (see the data checks), so expect a poor match: this checks the method, not real-world "
                  "accuracy." if checks else
                  "Tested on Plaid sandbox test data, so this checks the method, not real-world accuracy.")
        res = res.model_copy(update={"caveat": caveat, "assumptions": [
            caveat + " The sandbox repeats much the same transactions every month.", *checks, *res.assumptions[1:]]})
    return res


@app.get("/api/futures", response_model=FuturesResponse)
def get_futures(customer: str = CustomerParam):
    check_customer(customer)
    if config.USE_FIXTURES:
        return load(customer, "futures")
    need_history(customer, MIN_FORECAST_MONTHS, "the two futures")
    return actions.current_futures(customer, config.DEMO_TODAY).response


@app.post("/api/update_plan", response_model=UpdatePlanResponse)
def update_plan(req: WhatIfRequest):
    """Apply a what-if to the plan path. What-ifs stack until /api/reset."""
    check_customer(req.customer)
    if config.USE_FIXTURES:
        return load(req.customer, "update_plan")
    need_history(req.customer, MIN_FORECAST_MONTHS, "what-ifs")
    try:
        return actions.apply_whatif(req.customer, req, config.DEMO_TODAY)
    except WhatIfError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e


@app.post("/api/start_transfer", response_model=TransferResponse)
def start_transfer(req: TransferRequest):
    """Schedule a simulated transfer (no real money moves). Refused unless confirmed is exactly true, the amount is a
    $25 step up to $1,000, and it goes from the customer's checking account to their savings account."""
    check_customer(req.customer)
    if req.confirmed is not True:
        raise HTTPException(status_code=400, detail="Transfer needs a clear yes (confirmed=true). Nothing moved.")
    if config.USE_FIXTURES:
        return load(req.customer, "start_transfer")
    try:
        return actions.schedule_transfer(req, config.DEMO_TODAY)
    except actions.TransferError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.post("/api/stop_transfer", response_model=TransferResponse)
def stop_transfer(req: StopTransferRequest):
    """Stop a scheduled (simulated) transfer. 404 if there's no such transfer."""
    check_customer(req.customer)
    if config.USE_FIXTURES:
        t = load(req.customer, "start_transfer")
        return {**t, "status": "stopped", "sentence": "Stopped. This is a simulation: no real money moves."}
    try:
        return actions.stop_transfer(req)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@app.post("/api/reset", response_model=ResetResponse)
def reset(customer: str = CustomerParam):
    """Clear what-ifs and scheduled transfers: back to the starting demo state."""
    actions.reset(check_customer(customer))
    return ResetResponse(ok=True, customer=customer)


@app.post("/api/shock", response_model=ShockResponse)
def job_loss_shock(req: ShockRequest):
    """How long each future's cushion would last without pay. Changes nothing."""
    check_customer(req.customer)
    need_history(req.customer, MIN_FORECAST_MONTHS, "the job-loss check")
    try:
        return actions.job_loss_shock(req, config.DEMO_TODAY)
    except WhatIfError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e


@app.post("/api/setup", response_model=HealthResponse)
def answer_setup(req: SetupRequest):
    """Answer the two setup questions; indicators 7 and 8 (and the futures) re-score. Reset restores them."""
    check_customer(req.customer)
    return actions.set_setup(req.customer, req.setup, config.DEMO_TODAY)


# ---------------------------------------------------------------------------
# Plaid sandbox bank connection. Every Plaid call is made here, on the server; the browser only gets a link_token
# and sends back a public_token. Errors carry plain words and Plaid's error code, never keys or tokens.
# ---------------------------------------------------------------------------

def _plaid_http(e: plaid_client.PlaidError) -> HTTPException:
    log.warning("Plaid request failed: %s", e.code)  # the code only: never the request or the response
    return HTTPException(status_code=e.status, detail=str(e))


@app.get("/api/plaid/status", response_model=PlaidStatusResponse)
def plaid_status():
    """Whether the sandbox connection can be used (keys set), and the connected customer if there is one."""
    ok, reason = plaid_client.configured()
    return PlaidStatusResponse(configured=ok, reason=None if ok else reason, connection=connected.current())


@app.post("/api/plaid/link_token", response_model=PlaidLinkTokenResponse)
def plaid_link_token():
    """A short-lived token for opening Plaid Link in the browser (sandbox; transactions, plus liabilities)."""
    try:
        data = plaid_client.create_link_token("two-futures-demo-user")
    except plaid_client.PlaidError as e:
        raise _plaid_http(e) from None
    return PlaidLinkTokenResponse(link_token=data["link_token"], expiration=data.get("expiration"))


@app.post("/api/plaid/exchange", response_model=PlaidConnection)
def plaid_exchange(req: PlaidExchangeRequest):
    """Exchange Link's public_token, pull accounts, transactions and liabilities, and register the bank as
    customer 'sandbox'. Replaces any earlier connection."""
    try:
        return connected.connect(req.public_token)
    except plaid_client.PlaidError as e:
        raise _plaid_http(e) from None
    except AdapterError as e:
        raise HTTPException(status_code=422, detail=str(e)) from None
    except Exception:
        log.exception("Building the connected customer failed")
        raise HTTPException(status_code=500, detail="The bank's data couldn't be turned into a customer. "
                                                    "Try again or pick another test bank.") from None


@app.post("/api/plaid/disconnect", response_model=PlaidStatusResponse)
def plaid_disconnect():
    """Forget the connected bank (and remove it at Plaid). Maya and the household are untouched."""
    connected.disconnect()
    ok, reason = plaid_client.configured()
    return PlaidStatusResponse(configured=ok, reason=None if ok else reason, connection=None)
