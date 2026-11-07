"""Settings shared across the back end."""

import datetime as dt
import os

from dotenv import load_dotenv

load_dotenv()

# The demo's "today". Fixed so every run (and every rehearsal) shows the same numbers.
DEMO_TODAY = dt.date(2026, 11, 8)

CUSTOMERS = ("maya", "household")

# USE_FIXTURES=1 forces every endpoint to serve app/fixtures/*.json.
# Otherwise endpoints the engine already covers use it, and the rest fall back
# to fixtures until their milestone lands (update_plan, start_transfer, reset: M5).
USE_FIXTURES = os.getenv("USE_FIXTURES", "0") == "1"

ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
