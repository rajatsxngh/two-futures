"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, type BacktestResponse, type CustomerId, type ForecastResponse } from "@/lib/api";
import { goTo } from "@/lib/actions";
import { useApp } from "@/lib/store";
import { Card, MetricValue, NumberHook, SectionTitle, shortDate, usd } from "../ui";

const MARKER_KINDS = ["rent", "car", "card", "cd"] as const;
type MarkerKind = (typeof MARKER_KINDS)[number];
const MARKER_STYLE: Record<MarkerKind, { color: string; label: string }> = {
  rent: { color: "#0b2545", label: "Rent" },
  car: { color: "#5b8def", label: "Car payment" },
  card: { color: "#ef6a1a", label: "Card due" },
  cd: { color: "#9b5de5", label: "CD matures" },
};

// Account line colors: deliberately not red/amber/green (those mean indicator status).
const ACCOUNT_COLORS = ["#0b2545", "#ef6a1a", "#5b8def", "#9b5de5", "#8792a2", "#d9663f", "#2a9d9f", "#c06c84"];

const ts = (iso: string) => new Date(`${iso}T12:00:00`).getTime();
const monthTick = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short" });
const kUsd = (n: number) => (Math.abs(n) >= 1000 ? `$${(n / 1000).toFixed(Math.abs(n) >= 10000 ? 0 : 1)}k` : `$${Math.round(n)}`);

export function ForecastScreen() {
  const forecast = useApp((s) => s.forecast)!;
  const profile = useApp((s) => s.profile)!;
  return (
    <div className="space-y-4 px-4 py-4">
      <div>
        <h1 className="text-2xl font-semibold text-navy">Next 12 months</h1>
        <p className="text-sm text-muted">
          Your {profile.accounts.find((a) => a.type === "checking")?.name ?? "checking"} balance, day by day, from {forecast.runs.toLocaleString()} possible years.
        </p>
      </div>
      <CashChart forecast={forecast} />
      <BacktestCard />
      <AccountsChart forecast={forecast} />
      <Card className="bg-surface p-3">
        <p className="text-xs font-semibold text-navy">How this works</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] leading-snug text-muted">
          {forecast.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </Card>
      <button
        onClick={() => goTo("futures")}
        className="w-full rounded-2xl bg-accent py-3.5 text-lg font-semibold text-white shadow-lg shadow-accent/25 hover:bg-accent-dark"
      >
        Meet 2031
      </button>
    </div>
  );
}

function CashChart({ forecast }: { forecast: ForecastResponse }) {
  const data = useMemo(
    () => forecast.cash_series.map((p) => ({ t: ts(p.date), date: p.date, p50: p.p50, band: [p.p10, p.p90] as [number, number] })),
    [forecast],
  );
  const markers = useMemo(() => {
    const byT = new Map(data.map((d) => [d.date, d.p50]));
    return forecast.markers
      .filter((m): m is typeof m & { kind: MarkerKind } => (MARKER_KINDS as readonly string[]).includes(m.kind))
      .map((m) => ({ ...m, t: ts(m.date), y: byT.get(m.date) }))
      .filter((m) => m.y !== undefined);
  }, [forecast, data]);

  // One tick on the 1st of every other month.
  const ticks = useMemo(() => {
    if (!data.length) return [];
    const out: number[] = [];
    const d = new Date(data[0].t);
    d.setDate(1);
    d.setMonth(d.getMonth() + 1);
    while (d.getTime() <= data[data.length - 1].t) {
      out.push(d.getTime());
      d.setMonth(d.getMonth() + 2);
    }
    return out;
  }, [data]);

  const end = forecast.cash_series[forecast.cash_series.length - 1];
  const risk = forecast.overdraft_risk_90d;

  return (
    <Card className="px-2 pb-3 pt-3">
      <div className="flex items-start justify-between px-2">
        <div>
          <p className="text-xs text-muted">Typical balance in a year</p>
          <NumberHook
            id="forecast.cash.p50_end"
            metric={forecast.headline?.find((m) => m.id === "forecast.cash.p50_end")}
            className="text-[32px] font-semibold leading-tight text-navy"
          >
            {usd(end.p50)}
          </NumberHook>
          <p className="text-xs text-muted">
            Range{" "}
            <NumberHook id="forecast.cash.range" metric={forecast.headline?.find((m) => m.id === "forecast.cash.range")}>
              {usd(end.p10)} to {usd(end.p90)}
            </NumberHook>
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted">{risk.label}</p>
          <MetricValue metric={risk} className="text-xl font-semibold text-navy" />
        </div>
      </div>

      <div className="mt-2 h-[210px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
            <CartesianGrid vertical={false} stroke="var(--color-line)" />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickFormatter={monthTick}
              tick={{ fontSize: 10, fill: "var(--color-muted)" }}
              ticks={ticks}
              axisLine={false}
              tickLine={false}
            />
            <YAxis tickFormatter={kUsd} tick={{ fontSize: 10, fill: "var(--color-muted)" }} axisLine={false} tickLine={false} width={44} />
            <ReferenceLine y={0} stroke="var(--color-muted)" strokeDasharray="3 3" />
            <Tooltip content={<CashTooltip />} />
            <Area dataKey="band" stroke="none" fill="var(--color-accent)" fillOpacity={0.14} animationDuration={900} name="Good to bad range" />
            <Line dataKey="p50" stroke="var(--color-navy)" strokeWidth={2} dot={false} animationDuration={900} name="Typical" />
            {markers.map((m, i) => (
              <ReferenceDot
                key={`${m.kind}-${m.date}-${i}`}
                x={m.t}
                y={m.y}
                r={3.5}
                fill={MARKER_STYLE[m.kind].color}
                stroke="white"
                strokeWidth={1.5}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 px-2 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1">
          <span className="h-0.5 w-3 bg-navy" /> Typical
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-3 rounded-sm bg-accent/20" /> Good to bad range
        </span>
        {MARKER_KINDS.map((k) => (
          <span key={k} className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ background: MARKER_STYLE[k].color }} /> {MARKER_STYLE[k].label}
          </span>
        ))}
      </div>
      <p className="mt-2 px-2 text-xs font-semibold uppercase tracking-wide text-accent">{forecast.label}</p>
    </Card>
  );
}

type TooltipProps = { active?: boolean; payload?: { payload: { date: string; p50: number; band: [number, number] } }[] };

function CashTooltip({ active, payload }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-line bg-white px-2 py-1.5 text-[11px] shadow">
      <p className="font-semibold text-navy">{shortDate(d.date, true)}</p>
      <p className="text-navy">Typical {usd(d.p50)}</p>
      <p className="text-muted">
        {usd(d.band[0])} to {usd(d.band[1])}
      </p>
    </div>
  );
}

function AccountsChart({ forecast }: { forecast: ForecastResponse }) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const colorOf = (id: string) => ACCOUNT_COLORS[forecast.accounts.findIndex((a) => a.account_id === id) % ACCOUNT_COLORS.length];

  const data = useMemo(() => {
    const months = forecast.accounts[0]?.points.map((p) => p.month) ?? [];
    return months.map((month, i) => {
      const row: Record<string, number | string> = { month };
      for (const a of forecast.accounts) row[a.account_id] = a.points[i]?.balance ?? 0;
      return row;
    });
  }, [forecast]);

  const toggle = (id: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const debtTypes = new Set(["auto_loan", "personal_loan", "credit_card", "mortgage"]);

  return (
    <div>
      <SectionTitle>Every account</SectionTitle>
      <Card className="px-2 pb-3 pt-3">
        <div className="flex flex-wrap gap-1.5 px-2" role="group" aria-label="Show or hide accounts">
          {forecast.accounts.map((a) => {
            const on = !hidden.has(a.account_id);
            return (
              <button
                key={a.account_id}
                onClick={() => toggle(a.account_id)}
                aria-pressed={on}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                  on ? "border-navy/20 bg-white text-navy" : "border-line bg-surface text-muted line-through"
                }`}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: on ? colorOf(a.account_id) : "var(--color-line)" }} />
                {a.name}
              </button>
            );
          })}
        </div>
        <div className="mt-2 h-[170px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
              <CartesianGrid vertical={false} stroke="var(--color-line)" />
              <XAxis
                dataKey="month"
                tickFormatter={(m: string) => new Date(`${m}-15T12:00:00`).toLocaleDateString("en-US", { month: "short" })}
                tick={{ fontSize: 10, fill: "var(--color-muted)" }}
                axisLine={false}
                tickLine={false}
                interval={2}
              />
              <YAxis tickFormatter={kUsd} tick={{ fontSize: 10, fill: "var(--color-muted)" }} axisLine={false} tickLine={false} width={44} />
              <Tooltip formatter={(v) => usd(Number(v))} labelStyle={{ fontSize: 11 }} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
              {forecast.accounts
                .filter((a) => !hidden.has(a.account_id))
                .map((a) => (
                  <Line
                    key={a.account_id}
                    dataKey={a.account_id}
                    name={a.name}
                    stroke={colorOf(a.account_id)}
                    strokeWidth={2}
                    strokeDasharray={debtTypes.has(a.type) ? "4 3" : undefined}
                    dot={false}
                    animationDuration={600}
                  />
                ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="px-2 text-[11px] text-muted">Dashed lines are debts (amount owed).</p>

        <ul className="mt-2 divide-y divide-line px-2">
          {forecast.accounts
            .filter((a) => !hidden.has(a.account_id))
            .map((a) => {
              const start = a.points[0]?.balance ?? 0;
              const endPt = a.points[a.points.length - 1];
              const end = endPt?.balance ?? 0;
              const change = end - start;
              return (
                <li key={a.account_id} className="flex items-center justify-between py-2">
                  <span className="flex items-center gap-2 text-sm text-navy">
                    <span className="h-2 w-2 rounded-full" style={{ background: colorOf(a.account_id) }} />
                    {a.name}
                  </span>
                  <span className="text-right">
                    <NumberHook id={`forecast.account.${a.account_id}.end`} metric={a.end} className="text-sm font-semibold text-navy">
                      {usd(end)}
                    </NumberHook>
                    <span className="block text-[11px] text-muted">
                      {change >= 0 ? "+" : "−"}
                      {usd(Math.abs(change))} by {endPt ? new Date(`${endPt.month}-15T12:00:00`).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : ""}
                    </span>
                  </span>
                </li>
              );
            })}
        </ul>
      </Card>
    </div>
  );
}

/** "How good is this forecast?": the same forecast re-run on history with the last 91 days hidden. Hidden if the
 * back end can't serve it, so the screen never breaks over it. */
function BacktestCard() {
  const customer = useApp((s) => s.customer);
  const [result, setResult] = useState<{ customer: CustomerId; data: BacktestResponse | null } | null>(null);

  useEffect(() => {
    let live = true;
    api
      .backtest(customer)
      .then((data) => live && setResult({ customer, data }))
      .catch(() => live && setResult({ customer, data: null }));
    return () => {
      live = false;
    };
  }, [customer]);

  const bt = result?.customer === customer ? result.data : null;
  const data = useMemo(
    () => bt?.series.map((p) => ({ t: ts(p.date), actual: p.actual, p50: p.p50, band: [p.p10, p.p90] as [number, number] })) ?? [],
    [bt],
  );
  const ticks = useMemo(() => {
    if (!data.length) return [];
    const out: number[] = [];
    const d = new Date(data[0].t);
    d.setDate(1);
    d.setMonth(d.getMonth() + 1);
    while (d.getTime() <= data[data.length - 1].t) {
      out.push(d.getTime());
      d.setMonth(d.getMonth() + 1);
    }
    return out;
  }, [data]);

  if (!bt) return null;
  return (
    <div>
      <SectionTitle>How good is this forecast?</SectionTitle>
      <Card className="px-2 pb-3 pt-3">
        <p className="px-2 text-sm font-medium leading-snug text-navy">{bt.verdict}</p>
        <div className="mt-3 grid grid-cols-3 gap-2 px-2">
          <div>
            <p className="text-[11px] text-muted">Days in range</p>
            <MetricValue metric={bt.coverage_80} className="text-lg font-semibold text-navy" />
            <p className="text-[10px] text-muted">aim: about 80%</p>
          </div>
          <div>
            <p className="text-[11px] text-muted">Typical miss</p>
            <MetricValue metric={bt.median_error} className="text-lg font-semibold text-navy" />
            <p className="text-[10px] text-muted">per day</p>
          </div>
          <div>
            <p className="text-[11px] text-muted">Low point</p>
            <MetricValue metric={bt.low_actual} className="text-lg font-semibold text-navy" />
            <p className="text-[10px] text-muted">
              we said <MetricValue metric={bt.low_predicted} className="font-semibold" />
            </p>
          </div>
        </div>

        <div className="mt-2 h-[110px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -8 }}>
              <CartesianGrid vertical={false} stroke="var(--color-line)" />
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={["dataMin", "dataMax"]}
                tickFormatter={monthTick}
                tick={{ fontSize: 10, fill: "var(--color-muted)" }}
                ticks={ticks}
                axisLine={false}
                tickLine={false}
              />
              <YAxis tickFormatter={kUsd} tick={{ fontSize: 10, fill: "var(--color-muted)" }} axisLine={false} tickLine={false} width={44} />
              <Area dataKey="band" stroke="none" fill="var(--color-accent)" fillOpacity={0.14} isAnimationActive={false} name="Our range" />
              <Line dataKey="p50" stroke="var(--color-muted)" strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} name="Our typical" />
              <Line dataKey="actual" stroke="var(--color-navy)" strokeWidth={2} dot={false} isAnimationActive={false} name="Real balance" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 px-2 text-[11px] text-muted">
          <span className="inline-flex items-center gap-1">
            <span className="h-0.5 w-3 bg-navy" /> Real balance
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-0 w-3 border-t-2 border-dashed border-muted" /> Our typical
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-3 rounded-sm bg-accent/20" /> Our range
          </span>
        </div>
        <p className="mt-2 px-2 text-[11px] leading-snug text-muted">
          We hid the last {bt.holdout_days} days, learned from the {bt.train_months} months before, and forecast from {shortDate(bt.cutoff)}.
          The middle half of our range caught <MetricValue metric={bt.coverage_50} className="font-semibold text-navy" /> of days (aim: about 50%).{" "}
          {bt.caveat}
        </p>
      </Card>
    </div>
  );
}
