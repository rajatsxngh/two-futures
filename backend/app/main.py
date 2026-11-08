"""Future You API.

Each route serves the real engine once its milestone lands and falls back to
fixture JSON (same shape) until then, or always when USE_FIXTURES=1.
"""

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from . import config
from .engine import actions
from .engine.forecast import forecast_for
from .engine.health import health_for
from .engine.profile import profile_for
from .engine.whatif import WhatIfError
from .fixtures import load
from .models import (
    ForecastResponse,
    FuturesResponse,
    HealthResponse,
    ProfileResponse,
    ResetResponse,
    SetupRequest,
    ShockRequest,
    ShockResponse,
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

CustomerParam = Query("maya", description="Customer id: 'maya' or 'household'")


def check_customer(customer: str) -> str:
    if customer not in config.CUSTOMERS:
        raise HTTPException(status_code=404, detail=f"Unknown customer '{customer}'")
    return customer


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
    return forecast_for(customer, config.DEMO_TODAY)


@app.get("/api/futures", response_model=FuturesResponse)
def get_futures(customer: str = CustomerParam):
    check_customer(customer)
    if config.USE_FIXTURES:
        return load(customer, "futures")
    return actions.current_futures(customer, config.DEMO_TODAY).response


@app.post("/api/update_plan", response_model=UpdatePlanResponse)
def update_plan(req: WhatIfRequest):
    """Apply a what-if to the plan path. What-ifs stack until /api/reset."""
    check_customer(req.customer)
    if config.USE_FIXTURES:
        return load(req.customer, "update_plan")
    try:
        return actions.apply_whatif(req.customer, req, config.DEMO_TODAY)
    except WhatIfError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e


@app.post("/api/start_transfer", response_model=TransferResponse)
def start_transfer(req: TransferRequest):
    """Schedule a simulated transfer. Refused without confirmed=true: nothing moves without a clear yes."""
    check_customer(req.customer)
    if not req.confirmed:
        raise HTTPException(status_code=400, detail="Transfer needs a clear yes (confirmed=true). Nothing moved.")
    if config.USE_FIXTURES:
        return load(req.customer, "start_transfer")
    try:
        return actions.schedule_transfer(req, config.DEMO_TODAY)
    except actions.TransferError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.post("/api/reset", response_model=ResetResponse)
def reset(customer: str = CustomerParam):
    """Clear what-ifs and scheduled transfers: back to the starting demo state."""
    actions.reset(check_customer(customer))
    return ResetResponse(ok=True, customer=customer)


@app.post("/api/shock", response_model=ShockResponse)
def job_loss_shock(req: ShockRequest):
    """How long each future's cushion would last without pay. Changes nothing."""
    check_customer(req.customer)
    try:
        return actions.job_loss_shock(req, config.DEMO_TODAY)
    except WhatIfError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e


@app.post("/api/setup", response_model=HealthResponse)
def answer_setup(req: SetupRequest):
    """Answer the two setup questions; indicators 7 and 8 (and the futures) re-score. Reset restores them."""
    check_customer(req.customer)
    return actions.set_setup(req.customer, req.setup, config.DEMO_TODAY)
