"use client";

/**
 * Job-loss check (F12): "What if I lose my job for N months?" in both futures
 * side by side. Months of no pay covered = each path's cushion at that time.
 * Asks the engine (POST /api/shock); changes nothing.
 */
import { useEffect, useState } from "react";
import { api, type ShockResponse } from "@/lib/api";
import { useApp } from "@/lib/store";
import { MetricValue } from "./ui";

const MONTHS = [1, 3, 6];

export function JobLossCheck() {
  const customer = useApp((s) => s.customer);
  const futures = useApp((s) => s.futures); // refetch when the plan changes (what-ifs, setup)
  const [months, setMonths] = useState(3);
  const [year, setYear] = useState<number | null>(null);
  const [res, setRes] = useState<ShockResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const firstYear = futures ? Number(futures.as_of.slice(0, 4)) + 1 : 2027;
  const years = futures ? Array.from({ length: futures.target_year - firstYear + 1 }, (_, i) => firstYear + i) : [];
  const chosen = year ?? Math.min(firstYear + 2, futures?.target_year ?? firstYear);

  useEffect(() => {
    if (!futures) return;
    let alive = true;
    api
      .shock({ customer, job_loss_months: months, start_month: `${chosen}-01` })
      .then((r) => alive && (setRes(r), setError(null)))
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, [customer, months, chosen, futures]);

  return (
    <section className="rounded-2xl border border-line bg-white p-3" aria-label="Job-loss check">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Job-loss check</p>
      <p className="mt-0.5 text-sm text-navy">
        What if you lose your job for{" "}
        <select value={months} onChange={(e) => setMonths(Number(e.target.value))} className="rounded border border-line bg-surface px-1 text-sm font-semibold">
          {MONTHS.map((m) => (
            <option key={m} value={m}>
              {m} month{m > 1 ? "s" : ""}
            </option>
          ))}
        </select>{" "}
        in{" "}
        <select value={chosen} onChange={(e) => setYear(Number(e.target.value))} className="rounded border border-line bg-surface px-1 text-sm font-semibold">
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        ?
      </p>
      {error && <p className="mt-1 text-xs text-bad">{error}</p>}
      {res && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          {(["same_path", "plan"] as const).map((p) => {
            const r = res.paths[p];
            const full = r.covered_months >= res.job_loss_months;
            return (
              <div key={p} className={`rounded-xl p-2 ${p === "plan" ? "bg-plan-soft" : "bg-same-soft"}`}>
                <p className={`text-[11px] font-bold uppercase ${p === "plan" ? "text-plan" : "text-same"}`}>{p === "plan" ? "With a plan" : "Same path"}</p>
                <p className="text-[11px] text-muted">Savings cover</p>
                <MetricValue metric={r.runway} className="text-2xl font-semibold leading-tight text-navy" />
                <p className={`text-xs ${full ? "text-ok" : "text-navy"}`}>
                  {full ? "All of it" : <>On the card: <MetricValue metric={r.card} className="font-semibold" /></>}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
