"use client";

import { useState, type CSSProperties } from "react";
import type { CarLoanOption, CarPurchase, Metric, WhatIfRequest } from "@/lib/api";
import { openWhatIf, updatePlan, type UpdatePlanInput } from "@/lib/actions";
import { useApp } from "@/lib/store";
import { MetricValue, usd } from "./ui";

type Values = { income: number; spending: number; savings: number };
type Preset = {
  id: WhatIfRequest["preset"];
  label: string;
  description: string;
  values: Values;
  extra?: Partial<UpdatePlanInput>;
  note?: string;
  /** Shows the four car inputs; their values go in `car`. */
  car?: boolean;
};

const ZERO: Values = { income: 0, spending: 0, savings: 0 };
/** PNC's headline question: a $30,000 car with $5,000 down, 8% APR, 60 months. */
const CAR_DEFAULT: CarPurchase = { price: 30000, down: 5000, apr: 8, term_months: 60 };
const CAR_LABELS: Record<keyof CarPurchase, string> = { price: "Price", down: "Down payment", apr: "APR", term_months: "Months" };
/** Same limits as the API (models.py CarPurchase). */
const CAR_LIMITS: [keyof CarPurchase, number, number][] = [
  ["price", 1000, 150000],
  ["down", 0, 150000],
  ["apr", 0, 35],
  ["term_months", 12, 84],
];

function carProblem(c: CarPurchase): string | null {
  for (const [k, lo, hi] of CAR_LIMITS) {
    const v = c[k];
    if (!Number.isFinite(v) || v < lo || v > hi) return `${CAR_LABELS[k]} must be ${lo.toLocaleString("en-US")} to ${hi.toLocaleString("en-US")}.`;
  }
  if (!Number.isInteger(c.term_months)) return "Months must be a whole number.";
  if (c.down > c.price) return "The down payment can't be more than the price.";
  return null;
}

const PRESETS: Preset[] = [
  {
    id: "new_job",
    label: "New job",
    description: "What if I take the Austin job? $8,000 more a year, but rent is $300 higher.",
    values: { income: 8000, spending: 300, savings: 0 },
    extra: { start_month: "2027-01" },
    note: "Austin: +$8,000 a year, rent +$300",
  },
  {
    id: "move",
    label: "Move",
    description: "What if I move to a place with $300 higher rent?",
    values: { income: 0, spending: 300, savings: 0 },
  },
  {
    id: "big_purchase",
    label: "Big purchase",
    description: "What if I make a $3,000 purchase?",
    values: ZERO,
    extra: { one_time_cost: 3000 },
    note: "One-time cost: $3,000 (savings first, then the card)",
  },
  {
    id: "save_more",
    label: "Save more",
    description: "What if I save $100 more a month?",
    values: { income: 0, spending: 0, savings: 100 },
  },
  {
    id: "buy_home",
    label: "Buy a home",
    description: "What if I buy a $250,000 home in June 2029 with 5% down at 6.5%?",
    values: ZERO,
    extra: { start_month: "2029-06", home: { price: 250000, down_payment: 12500, rate: 6.5, term_years: 30 } },
    note: "$250,000 home, $12,500 down, 6.5% for 30 years, June 2029. The payment replaces rent.",
  },
  {
    id: "buy_car",
    label: "Buy a car",
    description: "What if I buy a $30,000 car with $5,000 down at 8% for 60 months?",
    values: ZERO,
    car: true,
    note: "The payment runs for the whole loan. Insurance, gas and repairs aren't included.",
  },
  {
    id: "job_loss",
    label: "Job loss",
    description: "What if I lose my job for 3 months?",
    values: ZERO,
    extra: { job_loss_months: 3 },
    note: "No income for 3 months",
  },
];

function signed(n: number, unit: string) {
  if (n === 0) return `no change`;
  return `${n > 0 ? "+" : "−"}${usd(Math.abs(n))}${unit}`;
}

function describe(v: Values) {
  const parts: string[] = [];
  if (v.income) parts.push(`income ${signed(v.income, " a year")}`);
  if (v.spending) parts.push(`spending ${signed(v.spending, " a month")}`);
  if (v.savings) parts.push(`saving ${signed(v.savings, " a month")}`);
  return parts.length ? `What if ${parts.join(", ")}?` : "";
}

export function WhatIfDrawer() {
  const open = useApp((s) => s.whatIfDrawerOpen);
  if (!open) return null;
  return <Drawer />;
}

function Drawer() {
  const pending = useApp((s) => s.whatIfPending);
  const whatIf = useApp((s) => s.whatIf);
  const [preset, setPreset] = useState<Preset | null>(null);
  const [values, setValues] = useState<Values>(ZERO);
  const [car, setCar] = useState<CarPurchase>(CAR_DEFAULT);

  const touched = preset ? values.income !== preset.values.income || values.spending !== preset.values.spending || values.savings !== preset.values.savings : true;
  const carOn = Boolean(preset?.car && !touched);
  const problem = carOn ? carProblem(car) : null;
  const description = carOn
    ? `What if I buy a ${usd(car.price)} car with ${usd(car.down)} down at ${car.apr}% for ${car.term_months} months?`
    : preset && !touched
      ? preset.description
      : describe(values);
  const hasChange =
    !problem && (Boolean((preset?.extra || preset?.car) && !touched) || values.income !== 0 || values.spending !== 0 || values.savings !== 0);

  const pick = (p: Preset) => {
    setPreset(p);
    setValues(p.values);
    if (p.car) setCar(CAR_DEFAULT);
  };

  const apply = () => {
    const extra = carOn ? { car } : preset && !touched ? preset.extra : undefined;
    void updatePlan({
      description: description || "What-if",
      preset: preset && !touched ? preset.id : "custom",
      income_change_yearly: values.income || null,
      spending_change_monthly: values.spending || null,
      savings_change_monthly: values.savings || null,
      ...extra,
    }).catch(() => {});
  };

  return (
    <div className="absolute inset-0 z-30 flex flex-col justify-end">
      <button aria-label="Close what-if" className="fade-in absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={() => openWhatIf(false)} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="What-if"
        className="sheet-up relative flex max-h-[88%] flex-col rounded-t-[32px] bg-white text-ink shadow-[0_-24px_60px_rgba(0,0,0,0.45)]"
      >
        <div className="phone-scroll overflow-y-auto px-5 pb-4 pt-2.5">
          <div aria-hidden className="mx-auto h-[5px] w-10 rounded-full bg-hair" />
          <div className="mt-4 flex items-baseline justify-between gap-3">
            <h2 className="text-[24px] font-semibold tracking-[-0.03em]">What if…?</h2>
            <span className="text-[12.5px] text-ink-3">Changes the plan path only</span>
          </div>

          <div className="relative -mx-5 mt-3.5">
            <div className="phone-scroll flex gap-2 overflow-x-auto px-5" role="group" aria-label="Presets">
              {PRESETS.map((p) => {
                const on = preset?.id === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => pick(p)}
                    aria-pressed={on}
                    className={`h-11 shrink-0 rounded-full px-4 text-sm transition ${
                      on ? "bg-ember font-semibold text-ink" : "border border-hair bg-white font-medium text-ink hover:border-ember/50"
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
            <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-11 bg-gradient-to-l from-white to-white/0" />
          </div>
          {preset?.note && !touched && <p className="mt-2.5 text-[13px] leading-snug text-ink-2">{preset.note}</p>}

          {carOn && (
            <div className="mt-3.5 grid grid-cols-2 gap-2.5">
              <NumberField label="Price" prefix="$" step={500} value={car.price} onChange={(price) => setCar((c) => ({ ...c, price }))} />
              <NumberField label="Down payment" prefix="$" step={500} value={car.down} onChange={(down) => setCar((c) => ({ ...c, down }))} />
              <NumberField label="APR" suffix="%" step={0.25} value={car.apr} onChange={(apr) => setCar((c) => ({ ...c, apr }))} />
              <NumberField label="Months" step={12} value={car.term_months} onChange={(term_months) => setCar((c) => ({ ...c, term_months }))} />
              {problem && (
                <p className="col-span-2 text-xs text-poor-ink" role="alert">
                  {problem}
                </p>
              )}
            </div>
          )}

          <div className="mt-[18px] space-y-4">
            <Slider label="Income" unit=" a year" min={-20000} max={30000} step={1000} value={values.income} onChange={(income) => setValues((v) => ({ ...v, income }))} />
            <Slider label="Spending" unit=" a month" min={-500} max={1000} step={50} value={values.spending} onChange={(spending) => setValues((v) => ({ ...v, spending }))} />
            <Slider label="Savings" unit=" a month" min={-200} max={500} step={25} value={values.savings} onChange={(savings) => setValues((v) => ({ ...v, savings }))} />
          </div>

          <div className="mt-[18px] min-h-[64px] rounded-[22px] bg-ember-soft p-4" aria-live="polite">
            {pending ? (
              <p className="text-sm text-ink-2">Running the numbers…</p>
            ) : whatIf ? (
              <>
                <p className="text-xs font-semibold text-ember-ink">What-if on the plan</p>
                <WhatIfDeltas deltas={whatIf.deltas} />
                <p className="mt-3 text-sm leading-[1.45] text-ink-2 [text-wrap:pretty]">{whatIf.sentence}</p>
                <CarOptions options={whatIf.car_options} />
              </>
            ) : (
              <p className="text-sm leading-snug text-ink-2">{description || "Pick a chip or move a slider."}</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5 border-t border-[#f0f0f2] px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-3.5">
          <button
            onClick={() => openWhatIf(false)}
            className="h-14 rounded-full border border-hair bg-white text-[15px] font-semibold text-ink transition hover:border-ink-3/40"
          >
            {whatIf ? "Done" : "Cancel"}
          </button>
          <button
            onClick={apply}
            disabled={!hasChange || pending}
            className="h-14 rounded-full bg-ember text-[15px] font-semibold text-ink shadow-[0_12px_30px_-12px_rgba(255,107,26,0.8)] transition hover:brightness-105 disabled:opacity-40 disabled:shadow-none"
          >
            Apply to my plan
          </button>
        </div>
      </div>
    </div>
  );
}

/** A slider that fills in ember from zero to the value, with a tick where zero sits. */
function Slider({
  label,
  unit,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  const id = `whatif-${label.toLowerCase()}`;
  const frac = (v: number) => (Math.min(max, Math.max(min, v)) - min) / (max - min);
  // Positions follow the thumb's centre, which travels 13px in from each end of the track.
  const at = (f: number) => `calc(13px + (100% - 26px) * ${f.toFixed(4)})`;
  const zero = frac(0);
  const now = frac(value);
  const fill = { "--lo": at(Math.min(zero, now)), "--hi": at(Math.max(zero, now)) } as CSSProperties;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-sm font-medium text-ink">
          {label}
        </label>
        <span className={`tabular text-sm font-semibold ${value === 0 ? "text-ink-3" : "text-ink"}`}>{signed(value, unit)}</span>
      </div>
      <div className="relative mt-1">
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 h-3.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#a1a1aa]"
          style={{ left: at(zero) }}
        />
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="tf-range relative block"
          style={fill}
        />
      </div>
    </div>
  );
}

/** The what-if's changes, each with its label. Every number comes from the engine. */
export function WhatIfDeltas({ deltas }: { deltas: Metric[] }) {
  return (
    <div className="mt-2.5 grid grid-cols-2 gap-x-3.5 gap-y-3">
      {deltas.map((d) => (
        <div key={d.id} className="flex min-w-0 flex-col gap-0.5">
          <MetricValue metric={d} animate className="self-start text-[22px] font-semibold leading-tight tracking-[-0.035em] text-ink" />
          <span className="text-xs text-[#6b4a3a]">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

/** Car what-if: the same loan at other lengths and APRs. Every number comes from the engine. */
export function CarOptions({ options }: { options?: CarLoanOption[] }) {
  if (!options?.length) return null;
  return (
    <div className="mt-3.5 rounded-[18px] bg-white/70 p-3">
      <table className="tabular w-full text-left text-xs text-ink">
        <caption className="mb-1.5 text-left text-xs font-semibold text-ink-3">Same loan, other options</caption>
        <thead className="text-ink-3">
          <tr>
            <th className="py-1 font-medium">Months</th>
            <th className="py-1 font-medium">APR</th>
            <th className="py-1 text-right font-medium">Payment</th>
            <th className="py-1 text-right font-medium">Total interest</th>
          </tr>
        </thead>
        <tbody>
          {options.map((o) => (
            <tr key={`${o.term_months}-${o.apr}`} className={`border-t border-black/[0.05] ${o.chosen ? "font-semibold" : ""}`}>
              <td className="py-1.5">
                {o.term_months}
                {o.chosen && <span className="ml-1.5 rounded-full bg-ember-soft px-1.5 py-px text-[10px] font-semibold text-ember-ink">yours</span>}
              </td>
              <td className="py-1.5">{o.apr}%</td>
              <td className="py-1.5 text-right">{usd(o.payment)}/mo</td>
              <td className="py-1.5 text-right">{usd(o.total_interest)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1.5 text-[11px] text-ink-3">Loan costs only. Insurance, gas and repairs aren&apos;t included.</p>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  step,
  prefix,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step: number;
  prefix?: string;
  suffix?: string;
}) {
  const id = `car-${label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <div>
      <label htmlFor={id} className="text-xs font-medium text-ink-2">
        {label}
      </label>
      <div className="mt-1 flex h-11 items-center rounded-2xl border border-hair bg-white px-3 transition focus-within:border-ember focus-within:ring-2 focus-within:ring-ember/20">
        {prefix && <span className="text-sm text-ink-3">{prefix}</span>}
        <input
          id={id}
          type="number"
          inputMode="decimal"
          step={step}
          value={Number.isFinite(value) ? value : ""}
          onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value))}
          className="tabular w-full min-w-0 bg-transparent pl-1 text-sm text-ink focus:outline-none"
        />
        {suffix && <span className="text-sm text-ink-3">{suffix}</span>}
      </div>
    </div>
  );
}
