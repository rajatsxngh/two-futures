"use client";

/**
 * Job-loss check (F12): "What if I lose my job for N months?" in both futures
 * side by side. Months of no pay covered = each path's cushion at that time.
 * Asks the engine (POST /api/shock); changes nothing.
 */
import { useEffect, useState, type ReactNode } from "react";
import { api, type ShockResponse } from "@/lib/api";
import { useApp } from "@/lib/store";
import { IconChevronDown } from "./icons";
import { MetricValue, StatusIcon } from "./ui";

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
    <section className="rounded-[26px] bg-tile p-[18px]" aria-label="Job-loss check">
      <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Job-loss check</h2>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[15px] leading-snug text-ink">
        <span>What if you lose your job for</span>
        <PillSelect label="Months without pay" value={months} onChange={setMonths}>
          {MONTHS.map((m) => (
            <option key={m} value={m}>
              {m} month{m > 1 ? "s" : ""}
            </option>
          ))}
        </PillSelect>
        <span>in</span>
        <PillSelect label="Year" value={chosen} onChange={setYear}>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </PillSelect>
        <span>?</span>
      </div>
      {error && <p className="mt-2 text-xs text-poor-ink">{error}</p>}
      {res && (
        <div className="mt-3.5 grid grid-cols-2 gap-2.5">
          {(["same_path", "plan"] as const).map((p) => {
            const r = res.paths[p];
            const full = r.covered_months >= res.job_loss_months;
            const isPlan = p === "plan";
            return (
              <div
                key={p}
                className={`flex min-w-0 flex-col gap-1 rounded-[20px] bg-white p-3.5 ${isPlan ? "shadow-[inset_0_0_0_1.5px_rgba(255,107,26,0.45)]" : ""}`}
              >
                <span className={`text-xs font-semibold ${isPlan ? "text-ember-ink" : "text-silver-ink"}`}>{isPlan ? "With a plan" : "Same path"}</span>
                <span className="mt-1.5 text-xs text-ink-3">Savings cover</span>
                <MetricValue metric={r.runway} className="self-start text-[24px] font-semibold leading-tight tracking-[-0.04em] text-ink" />
                {full ? (
                  <Line status="green">All of it</Line>
                ) : (
                  <span className="mt-1 text-[12.5px] text-ink-2">
                    On the card: <MetricValue metric={r.card} className="font-semibold text-ink" />
                  </span>
                )}
                {r.unpaid ? (
                  <Line status="red">
                    Bills unpaid: <MetricValue metric={r.unpaid} className="font-semibold" />
                  </Line>
                ) : (
                  !full && <Line status="green">No bills unpaid</Line>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Line({ status, children }: { status: "green" | "red"; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-[12.5px] ${status === "green" ? "text-good-ink" : "text-poor-ink"}`}>
      <StatusIcon status={status} className="h-3 w-3" />
      <span>{children}</span>
    </span>
  );
}

function PillSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  children: ReactNode;
}) {
  return (
    <span className="relative inline-flex">
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="tabular h-11 cursor-pointer appearance-none rounded-full border border-hair bg-white pl-3.5 pr-8 text-sm font-semibold text-ink transition hover:border-ink-3/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember/50"
      >
        {children}
      </select>
      <IconChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3" strokeWidth={2.2} />
    </span>
  );
}
