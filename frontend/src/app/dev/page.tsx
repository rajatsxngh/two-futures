"use client";

/**
 * M1 contract check: calls every endpoint and shows its raw JSON.
 * Kept as a debugging page for the whole build.
 */
import { useCallback, useEffect, useState } from "react";
import { api, type CustomerId } from "@/lib/api";

type Row = { name: string; status: "loading" | "ok" | "error"; ms?: number; data?: unknown; error?: string };

const AUSTIN = {
  description: "What if I take the Austin job? $8,000 more a year, but rent is $300 higher.",
  preset: "new_job" as const,
  income_change_yearly: 8000,
  spending_change_monthly: 300,
  start_month: "2027-01",
};

const TRANSFER = {
  amount: 150,
  from_account_id: "spend",
  to_account_id: "reserve",
  frequency: "payday" as const,
};

function calls(c: CustomerId): [string, () => Promise<unknown>][] {
  return [
    ["GET /api/profile", () => api.profile(c)],
    ["GET /api/health", () => api.health(c)],
    ["GET /api/forecast", () => api.forecast(c)],
    ["GET /api/futures", () => api.futures(c)],
    ["POST /api/update_plan", () => api.updatePlan({ ...AUSTIN, customer: c })],
    [
      "POST /api/start_transfer (no yes, expect 400)",
      () => api.startTransfer({ ...TRANSFER, customer: c, confirmed: false }),
    ],
    ["POST /api/start_transfer (yes)", () => api.startTransfer({ ...TRANSFER, customer: c, confirmed: true })],
    ["POST /api/reset", () => api.reset(c)],
  ];
}

export default function DevPage() {
  const [customer, setCustomer] = useState<CustomerId>("maya");
  const [rows, setRows] = useState<Row[]>([]);

  const run = useCallback(async (c: CustomerId) => {
    const list = calls(c);
    setRows(list.map(([name]) => ({ name, status: "loading" })));
    await Promise.all(
      list.map(async ([name, fn], i) => {
        const t0 = performance.now();
        try {
          const data = await fn();
          const ms = Math.round(performance.now() - t0);
          setRows((r) => r.map((row, j) => (j === i ? { name, status: "ok", ms, data } : row)));
        } catch (e) {
          const ms = Math.round(performance.now() - t0);
          setRows((r) => r.map((row, j) => (j === i ? { name, status: "error", ms, error: String(e) } : row)));
        }
      }),
    );
  }, []);

  useEffect(() => {
    run(customer);
  }, [customer, run]);

  return (
    <main className="mx-auto w-full max-w-5xl p-6 font-sans">
      <h1 className="text-2xl font-semibold">API contract check</h1>
      <p className="mt-1 text-sm text-zinc-600">
        Every endpoint, called through the Next /api proxy. The 400 on the first transfer is expected: nothing moves
        without a clear yes.
      </p>
      <div className="mt-4 flex gap-2">
        {(["maya", "household"] as const).map((c) => (
          <button
            key={c}
            onClick={() => setCustomer(c)}
            className={`rounded-full border px-4 py-1.5 text-sm ${customer === c ? "bg-zinc-900 text-white" : ""}`}
          >
            {c}
          </button>
        ))}
        <button onClick={() => run(customer)} className="rounded-full border px-4 py-1.5 text-sm">
          Re-run
        </button>
      </div>
      <ul className="mt-6 space-y-3">
        {rows.map((row) => (
          <li key={row.name} className="rounded-lg border p-3" data-status={row.status}>
            <details>
              <summary className="cursor-pointer text-sm">
                <span className="mr-2">{row.status === "ok" ? "OK" : row.status === "error" ? "ERR" : "..."}</span>
                <span className="font-mono">{row.name}</span>
                {row.ms !== undefined && <span className="ml-2 text-zinc-500">{row.ms} ms</span>}
                {row.error && <span className="ml-2 text-amber-700">{row.error}</span>}
              </summary>
              {row.data !== undefined && (
                <pre className="mt-2 max-h-96 overflow-auto rounded bg-zinc-50 p-3 text-xs">
                  {JSON.stringify(row.data, null, 2)}
                </pre>
              )}
            </details>
          </li>
        ))}
      </ul>
    </main>
  );
}
