"""Future You API.

M1: every endpoint is a stub that serves fixture JSON with the final response
shape. Later milestones swap each body for the real engine without changing
the route or its response model.
"""

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from . import config
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
    return load(check_customer(customer), "profile")


@app.get("/api/health", response_model=HealthResponse)
def get_health(customer: str = CustomerParam):
    return load(check_customer(customer), "health")


@app.get("/api/forecast", response_model=ForecastResponse)
def get_forecast(customer: str = CustomerParam):
    return load(check_customer(customer), "forecast")


@app.get("/api/futures", response_model=FuturesResponse)
def get_futures(customer: str = CustomerParam):
    return load(check_customer(customer), "futures")


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
