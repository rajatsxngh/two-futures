"""Settings shared across the back end."""

import datetime as dt
import os

from dotenv import load_dotenv

load_dotenv()

# The demo's "today". Fixed so every run (and every rehearsal) shows the same numbers.
DEMO_TODAY = dt.date(2026, 11, 8)

CUSTOMERS = ("maya", "household")

# "fixtures" serves app/fixtures/*.json. Each endpoint switches to the real
# engine as milestones M2-M5 land; front-end work can keep USE_FIXTURES=1.
USE_FIXTURES = os.getenv("USE_FIXTURES", "1") == "1"

ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
