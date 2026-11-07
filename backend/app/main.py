"""Future You API.

Each route serves the real engine once its milestone lands and falls back to
fixture JSON (same shape) until then, or always when USE_FIXTURES=1.
"""

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from . import config
from .engine import data as customer_data
from .engine.forecast import forecast_for
from .engine.futures import futures_for
from .engine.health import health_for
from .engine.profile import profile_for
from .fixtures import load
from .models import (
    ForecastResponse,
    FuturesResponse,
    HealthResponse,
    ProfileResponse,
    ResetResponse,
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
    data = customer_data.load(customer)
    return profile_for(data, health_for(data, config.DEMO_TODAY), config.DEMO_TODAY)


@app.get("/api/health", response_model=HealthResponse)
def get_health(customer: str = CustomerParam):
    check_customer(customer)
    if config.USE_FIXTURES:
        return load(customer, "health")
    return health_for(customer_data.load(customer), config.DEMO_TODAY)


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
    return futures_for(customer, config.DEMO_TODAY).response


@app.post("/api/update_plan", response_model=UpdatePlanResponse)
def update_plan(req: WhatIfRequest):
    return load(check_customer(req.customer), "update_plan")


@app.post("/api/start_transfer", response_model=TransferResponse)
def start_transfer(req: TransferRequest):
    check_customer(req.customer)
    if not req.confirmed:
        raise HTTPException(status_code=400, detail="Transfer needs a clear yes (confirmed=true). Nothing moved.")
    return load(req.customer, "start_transfer")


@app.post("/api/reset", response_model=ResetResponse)
def reset(customer: str = CustomerParam):
    return ResetResponse(ok=True, customer=check_customer(customer))
