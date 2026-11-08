"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { api, type BacktestResponse, type CustomerId, type ForecastResponse, type Metric } from "@/lib/api";
import { goTo } from "@/lib/actions";
import { useApp } from "@/lib/store";
import { IconArrowRight } from "../icons";
import { Hero, MetricValue, NumberHook, PaperSheet, SectionTitle, shortDate, usd } from "../ui";

/** Bills drawn as lanes under the cash chart (one row per kind), in the same time scale. */
const MARKER_KINDS = ["rent", "car", "card", "cd"] as const;
type MarkerKind = (typeof MARKER_KINDS)[number];
const LANES: Record<MarkerKind, { color: string; label: string; legend: string }> = {
  rent: { color: "#E4E4E7", label: "Rent", legend: "Rent" },
  car: { color: "#7AA2FF", label: "Car", legend: "Car payment" },
  card: { color: "#FF6B1A", label: "Card", legend: "Card due" },
  cd: { color: "#C4A1FF", label: "CD", legend: "CD matures" },
};

// Account lines on paper: deliberately not red/amber/green (those mean indicator status).
const ACCOUNT_COLORS = ["#0A0A0B", "#FF6B1A", "#8B5CF6", "#2563EB", "#71717A", "#0D9488", "#C2410C", "#DB2777"];
const DEBT_TYPES = new Set(["auto_loan", "personal_loan", "credit_card", "mortgage"]);

const ts = (iso: string) => new Date(`${iso}T12:00:00`).getTime();
const monthTick = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short" });
const kUsd = (n: number) => (Math.abs(n) >= 1000 ? `$${(n / 1000).toFixed(Math.abs(n) >= 10000 ? 0 : 1)}k` : `$${Math.round(n)}`);

/** The 1st of every `step`-th month inside the range. */
function monthTicks(t0: number, t1: number, step: number) {
  const out: number[] = [];
  const d = new Date(t0);
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  while (d.getTime() <= t1) {
    out.push(d.getTime());
    d.setMonth(d.getMonth() + step);
  }
  return out;
}

// Both charts in the hero share these, so the bill lanes line up with the cash line underneath it.
const HERO_MARGIN = { top: 8, right: 10, bottom: 0, left: -8 };
const Y_WIDTH = 44;
const AXIS_TICK = { fontSize: 10.5, fill: "#8B8B94" };

export function ForecastScreen() {
  const forecast = useApp((s) => s.forecast)!;
  const profile = useApp((s) => s.profile)!;
  const year = useApp((s) => s.futures?.target_year ?? null);
  const end = forecast.cash_series[forecast.cash_series.length - 1];
  const risk = forecast.overdraft_risk_90d;
  const checking = profile.accounts.find((a) => a.type === "checking")?.name ?? "checking";

  return (
    <div className="flex flex-1 flex-col">
      <Hero>
        <h1 className="text-[30px] font-semibold leading-[1.08] tracking-[-0.035em] text-snow">Next 12 months</h1>
        <p className="mt-2 text-sm leading-[1.45] text-fog [text-wrap:pretty]">
          Your {checking} balance, day by day, from {forecast.runs.toLocaleString()} possible years.
        </p>

        <div className="mt-6 flex items-end justify-between gap-3.5">
          <div className="min-w-0">
            <p className="text-[13px] text-fog">Typical balance in a year</p>
            <NumberHook
              id="forecast.cash.p50_end"
              metric={forecast.headline?.find((m) => m.id === "forecast.cash.p50_end")}
              className="mt-1.5 text-[52px] font-medium leading-none tracking-[-0.055em] text-snow"
            >
              {usd(end.p50)}
            </NumberHook>
            <p className="mt-2.5 flex flex-wrap items-center gap-x-1.5 text-[13px] text-fog">
              Range
              <NumberHook
                id="forecast.cash.range"
                metric={forecast.headline?.find((m) => m.id === "forecast.cash.range")}
                className="font-semibold text-snow"
              >
                {usd(end.p10)} to {usd(end.p90)}
              </NumberHook>
            </p>
          </div>
          <div className="glass flex w-[132px] shrink-0 flex-col gap-1.5 rounded-[22px] px-3.5 pb-3 pt-3.5">
            <MetricValue metric={risk} className="self-start text-[28px] font-semibold leading-none tracking-[-0.04em] text-snow" />
            <p className="text-xs leading-[1.35] text-fog">{risk.label}</p>
          </div>
        </div>

        <CashChart forecast={forecast} />
      </Hero>

      <PaperSheet label="How good the forecast is, and every account">
        <BacktestCard />
        <AccountsChart forecast={forecast} />
        <section aria-label="How this works" className="mt-6 rounded-[24px] bg-tile p-[18px]">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">How this works</h2>
          <ul className="mt-3 flex flex-col gap-2.5">
            {forecast.assumptions.map((a) => (
              <li key={a} className="flex gap-2.5 text-[13px] leading-[1.5] text-ink-2">
                <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[#a1a1aa]" />
                {a}
              </li>
            ))}
          </ul>
        </section>
        {year && (
          <button
            onClick={() => goTo("futures")}
            className="mt-4 flex h-14 w-full items-center justify-center gap-2.5 rounded-full bg-ink text-base font-semibold tracking-[-0.01em] text-snow transition hover:bg-black active:scale-[0.99]"
          >
            Meet {year}
            <IconArrowRight className="h-[18px] w-[18px]" strokeWidth={1.9} />
          </button>
        )}
      </PaperSheet>
    </div>
  );
}

function CashChart({ forecast }: { forecast: ForecastResponse }) {
  const data = useMemo(
    () => forecast.cash_series.map((p) => ({ t: ts(p.date), date: p.date, p50: p.p50, band: [p.p10, p.p90] as [number, number] })),
    [forecast],
  );
  const domain = useMemo<[number, number]>(() => [data[0]?.t ?? 0, data[data.length - 1]?.t ?? 1], [data]);
  const ticks = useMemo(() => monthTicks(domain[0], domain[1], 2), [domain]);
  const lanes = useMemo(
    () =>
      MARKER_KINDS.map((kind) => ({
        kind,
        points: forecast.markers.filter((m) => m.kind === kind).map((m) => ({ t: ts(m.date) })),
      })).filter((l) => l.points.length > 0),
    [forecast],
  );
  const laneRows = lanes.map((l, i) => ({ ...l, points: l.points.map((p) => ({ ...p, lane: i })) }));
  const last = data[data.length - 1];
  const end = forecast.cash_series[forecast.cash_series.length - 1];

  return (
    <figure className="mt-5">
      <div
        role="img"
        aria-label={`Balance forecast for the next 12 months: typically ${usd(end.p50)} in a year, with a good-to-bad range of ${usd(end.p10)} to ${usd(end.p90)}.`}
        className="h-[200px] w-full"
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={HERO_MARGIN}>
            <defs>
              <linearGradient id="tf-band" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#FF6B1A" stopOpacity={0.34} />
                <stop offset="1" stopColor="#FF6B1A" stopOpacity={0.12} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.07)" />
            <XAxis dataKey="t" type="number" scale="time" domain={domain} hide />
            <YAxis tickFormatter={kUsd} tick={AXIS_TICK} axisLine={false} tickLine={false} width={Y_WIDTH} />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.32)" strokeDasharray="3 4" />
            <Tooltip content={<CashTooltip />} cursor={{ stroke: "rgba(255,255,255,0.22)" }} />
            <Area dataKey="band" stroke="none" fill="url(#tf-band)" animationDuration={900} name="Good to bad range" />
            <Line dataKey="p50" stroke="#F4F4F5" strokeOpacity={0.92} strokeWidth={1.3} dot={false} animationDuration={900} name="Typical" />
            {last && (
              <ReferenceLine
                segment={[
                  { x: last.t, y: last.band[0] },
                  { x: last.t, y: last.band[1] },
                ]}
                stroke="#FF8A4C"
                strokeWidth={1.5}
              />
            )}
            {last && <ReferenceDot x={last.t} y={last.p50} r={3.6} fill="#FFFFFF" stroke="rgba(255,255,255,0.16)" strokeWidth={10} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {laneRows.length > 0 && (
        <div className="h-[92px] w-full" aria-hidden>
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ ...HERO_MARGIN, top: 6 }}>
              <CartesianGrid horizontal={false} vertical={false} />
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={domain}
                ticks={ticks}
                tickFormatter={monthTick}
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                dataKey="lane"
                type="number"
                domain={[-0.6, laneRows.length - 0.4]}
                ticks={laneRows.map((_, i) => i)}
                tickFormatter={(v: number) => LANES[laneRows[v]?.kind ?? "rent"].label}
                reversed
                tick={{ fontSize: 9.5, fill: "#8B8B94" }}
                axisLine={false}
                tickLine={false}
                width={Y_WIDTH}
                interval={0}
              />
              <ZAxis range={[26, 26]} />
              {laneRows.map((l) => (
                <Scatter key={l.kind} data={l.points} fill={LANES[l.kind].color} isAnimationActive={false} />
              ))}
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}

      <figcaption className="mt-2.5 flex items-center justify-between gap-3">
        <span className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs text-fog">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-0.5 w-3.5 rounded-full bg-snow" />
            Typical
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-2.5 w-3.5 rounded-[3px] bg-ember/35" />
            Good to bad range
          </span>
        </span>
        <span className="shrink-0 text-xs font-semibold text-ember-text">{forecast.label}</span>
      </figcaption>
      {laneRows.length > 0 && (
        <p className="sr-only">
          Under the chart, one row per bill: {laneRows.map((l) => LANES[l.kind].legend.toLowerCase()).join(", ")}.
        </p>
      )}
    </figure>
  );
}

type TooltipProps = { active?: boolean; payload?: { payload: { date: string; p50: number; band: [number, number] } }[] };

function CashTooltip({ active, payload }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-xl border border-white/10 bg-raised/95 px-2.5 py-2 text-[11px] text-snow shadow-xl backdrop-blur">
      <p className="font-semibold">{shortDate(d.date, true)}</p>
      <p className="tabular">Typical {usd(d.p50)}</p>
      <p className="tabular text-fog">
        {usd(d.band[0])} to {usd(d.band[1])}
      </p>
    </div>
  );
}

const PAPER_TICK = { fontSize: 10.5, fill: "#63636C" };

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

  const shown = forecast.accounts.filter((a) => !hidden.has(a.account_id));

  return (
    <section className="mt-7" aria-label="Every account">
      <SectionTitle right={<span className="text-[13px] text-ink-3">Tap to hide</span>}>Every account</SectionTitle>
      <div className="phone-scroll -mx-5 mt-3.5 flex gap-2 overflow-x-auto px-5" role="group" aria-label="Show or hide accounts">
        {forecast.accounts.map((a) => {
          const on = !hidden.has(a.account_id);
          return (
            <button
              key={a.account_id}
              onClick={() => toggle(a.account_id)}
              aria-pressed={on}
              className={`flex h-11 shrink-0 items-center gap-2 rounded-full pl-3 pr-3.5 text-[13.5px] font-medium transition ${
                on ? "bg-tile text-ink" : "border border-dashed border-hair bg-white text-ink-3 line-through"
              }`}
            >
              <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: on ? colorOf(a.account_id) : "#d4d4d8" }} />
              {a.name}
            </button>
          );
        })}
      </div>

      <div className="mt-4 h-[170px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 10, bottom: 0, left: -8 }}>
            <CartesianGrid vertical={false} stroke="rgba(10,10,11,0.06)" />
            <XAxis
              dataKey="month"
              tickFormatter={(m: string) => new Date(`${m}-15T12:00:00`).toLocaleDateString("en-US", { month: "short" })}
              tick={PAPER_TICK}
              axisLine={false}
              tickLine={false}
              interval={2}
            />
            <YAxis tickFormatter={kUsd} tick={PAPER_TICK} axisLine={false} tickLine={false} width={Y_WIDTH} />
            <Tooltip
              formatter={(v) => usd(Number(v))}
              labelStyle={{ fontSize: 11, color: "#0A0A0B", fontWeight: 600 }}
              contentStyle={{ fontSize: 11, borderRadius: 12, border: "1px solid #E4E4E7", boxShadow: "0 8px 24px -8px rgba(10,10,11,0.2)" }}
            />
            {shown.map((a) => (
              <Line
                key={a.account_id}
                dataKey={a.account_id}
                name={a.name}
                stroke={colorOf(a.account_id)}
                strokeWidth={2}
                strokeDasharray={DEBT_TYPES.has(a.type) ? "4 3" : undefined}
                dot={false}
                animationDuration={600}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-xs text-ink-3">Dashed lines are debts (amount owed).</p>

      <ul className="mt-3">
        {shown.map((a) => {
          const start = a.points[0]?.balance ?? 0;
          const endPt = a.points[a.points.length - 1];
          const end = endPt?.balance ?? 0;
          const change = end - start;
          return (
            <li key={a.account_id} className="flex min-h-[58px] items-center justify-between gap-3 border-t border-[#f0f0f2] last:border-b">
              <span className="flex min-w-0 items-center gap-3 text-[15px] font-medium text-ink">
                <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorOf(a.account_id) }} />
                <span className="truncate">{a.name}</span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-0.5">
                <NumberHook id={`forecast.account.${a.account_id}.end`} metric={a.end} className="text-[15px] font-semibold text-ink">
                  {usd(end)}
                </NumberHook>
                <span className="tabular text-xs text-ink-3">
                  {change >= 0 ? "+" : "−"}
                  {usd(Math.abs(change))} by{" "}
                  {endPt ? new Date(`${endPt.month}-15T12:00:00`).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : ""}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Stat({ label, metric, note }: { label: string; metric: Metric; note: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-[18px] bg-tile p-3">
      <span className="text-[11.5px] leading-tight text-ink-3">{label}</span>
      <MetricValue metric={metric} className="self-start text-lg font-semibold tracking-[-0.02em] text-ink" />
      <span className="text-[11px] leading-tight text-ink-3">{note}</span>
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
  const ticks = useMemo(() => (data.length ? monthTicks(data[0].t, data[data.length - 1].t, 1) : []), [data]);

  if (!bt) return null;
  return (
    <section className="mt-[18px]" aria-label="How good is this forecast?">
      <SectionTitle>How good is this forecast?</SectionTitle>
      <p className="mt-2 text-[15px] font-medium leading-[1.45] tracking-[-0.01em] text-ink [text-wrap:pretty]">{bt.verdict}</p>
      <div className="mt-3.5 grid grid-cols-3 gap-2.5">
        <Stat label="Days in range" metric={bt.coverage_80} note="aim: about 80%" />
        <Stat label="Typical miss" metric={bt.median_error} note="per day" />
        <Stat
          label="Low point"
          metric={bt.low_actual}
          note={
            <>
              we said <MetricValue metric={bt.low_predicted} className="font-semibold text-ink-2" />
            </>
          }
        />
      </div>

      <div className="mt-3.5 h-[120px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 6, right: 10, bottom: 0, left: -8 }}>
            <CartesianGrid vertical={false} stroke="rgba(10,10,11,0.06)" />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickFormatter={monthTick}
              tick={PAPER_TICK}
              ticks={ticks}
              axisLine={false}
              tickLine={false}
            />
            <YAxis tickFormatter={kUsd} tick={PAPER_TICK} axisLine={false} tickLine={false} width={Y_WIDTH} />
            <Area dataKey="band" stroke="none" fill="#FF6B1A" fillOpacity={0.14} isAnimationActive={false} name="Our range" />
            <Line dataKey="p50" stroke="#A1A1AA" strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} name="Our typical" />
            <Line dataKey="actual" stroke="#0A0A0B" strokeWidth={2} dot={false} isAnimationActive={false} name="Real balance" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs text-ink-3">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-3.5 rounded-full bg-ink" />
          Real balance
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-0 w-3.5 border-t-2 border-dashed border-[#a1a1aa]" />
          Our typical
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-3.5 rounded-[3px] bg-ember/20" />
          Our range
        </span>
      </div>
      <p className="mt-2.5 text-xs leading-[1.5] text-ink-3">
        We hid the last {bt.holdout_days} days, learned from the {bt.train_months} months before, and forecast from {shortDate(bt.cutoff)}.
        The middle half of our range caught <MetricValue metric={bt.coverage_50} className="font-semibold text-ink-2" /> of days (aim: about
        50%). {bt.caveat}
      </p>
    </section>
  );
}
