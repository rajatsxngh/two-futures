"use client";

import type { Account, HealthResponse, Indicator, UpcomingBill } from "@/lib/api";
import { goTo, showIndicators } from "@/lib/actions";
import { useApp } from "@/lib/store";
import { BackButton, Card, MetricValue, NumberHook, SectionTitle, StatusIcon, StatusPill, shortDate, usd } from "../ui";

const BAND_LABEL = { vulnerable: "Vulnerable", coping: "Coping", healthy: "Healthy" } as const;

export function TodayScreen() {
  const profile = useApp((s) => s.profile)!;
  const health = useApp((s) => s.health)!;
  const showTiles = useApp((s) => s.showIndicators);

  if (showTiles) return <IndicatorTiles health={health} onBack={() => showIndicators(false)} />;

  const firstName = profile.customer.name;
  return (
    <div className="space-y-4 px-4 py-4">
      <div>
        <p className="text-sm text-muted">{greeting()},</p>
        <h1 className="text-2xl font-semibold text-navy">{firstName}</h1>
        <p className="mt-2 text-[15px] leading-snug text-navy/85">{profile.summary.join(" ")}</p>
      </div>

      <ScoreCard health={health} onOpen={() => showIndicators(true)} />

      <Accounts />

      <BillsStrip bills={profile.bills_next_90} />

      <button
        onClick={() => goTo("futures")}
        className="flex w-full items-center justify-between rounded-2xl bg-accent px-5 py-4 text-left text-white shadow-lg shadow-accent/25 transition hover:bg-accent-dark active:scale-[0.99]"
      >
        <span>
          <span className="block text-xl font-semibold">Meet 2031</span>
          <span className="block text-sm text-white/85">Talk to two versions of future you</span>
        </span>
        <svg viewBox="0 0 20 20" className="h-6 w-6" fill="currentColor" aria-hidden>
          <path d="M7.3 4.3a1 1 0 0 1 1.4 0l5 5a1 1 0 0 1 0 1.4l-5 5a1 1 0 0 1-1.4-1.4L11.58 10 7.3 5.7a1 1 0 0 1 0-1.4Z" />
        </svg>
      </button>

      <button onClick={() => goTo("forecast")} className="w-full py-1 text-center text-sm font-medium text-accent">
        See the next 12 months
      </button>
    </div>
  );
}

function greeting() {
  // The demo's "today" is fixed, so a fixed greeting keeps runs identical.
  return "Good morning";
}

function ScoreRing({ value, size = 132 }: { value: number; size?: number }) {
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-line)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.max(0, Math.min(100, value)) / 100)}
        style={{ transition: "stroke-dashoffset 900ms ease-out" }}
      />
    </svg>
  );
}

function ScoreCard({ health, onOpen }: { health: HealthResponse; onOpen: () => void }) {
  const score = Number(health.score.value ?? 0);
  return (
    <Card>
      <button onClick={onOpen} className="flex w-full items-center gap-4 text-left" aria-label="Open the 8 health indicators">
        <div className="relative shrink-0">
          <ScoreRing value={score} />
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <MetricValue metric={health.score} className="text-[44px] font-semibold leading-none text-navy" animate />
            <span className="mt-1 text-xs font-medium text-muted">{BAND_LABEL[health.band]}</span>
          </div>
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm font-semibold text-navy">Financial health</p>
          {health.pillars.map((p) => {
            const v = Number(p.score.value ?? 0);
            return (
              <div key={p.id}>
                <div className="flex justify-between text-xs">
                  <span className="text-muted">{p.label}</span>
                  <MetricValue metric={p.score} className="font-semibold text-navy" />
                </div>
                <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-line">
                  <div className="h-full rounded-full bg-navy" style={{ width: `${v}%`, transition: "width 700ms ease-out" }} />
                </div>
              </div>
            );
          })}
        </div>
      </button>
      <button onClick={onOpen} className="mt-3 w-full rounded-xl bg-surface py-2 text-sm font-medium text-navy">
        See all 8 indicators
      </button>
    </Card>
  );
}

function IndicatorTiles({ health, onBack }: { health: HealthResponse; onBack: () => void }) {
  return (
    <div className="space-y-3 px-4 py-4">
      <BackButton onClick={onBack} label="Today" />
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold text-navy">8 health indicators</h1>
          <p className="text-sm text-muted">Spend, Save, Borrow and Plan, two each.</p>
        </div>
        <MetricValue metric={health.score} className="text-[36px] font-semibold leading-none text-navy" />
      </div>
      {health.pillars.map((p) => (
        <div key={p.id}>
          <SectionTitle right={<MetricValue metric={p.score} className="text-sm font-semibold text-navy" />}>{p.label}</SectionTitle>
          <div className="grid grid-cols-2 gap-2">
            {p.indicator_ids.map((id) => {
              const ind = health.indicators.find((i) => i.id === id);
              return ind ? <IndicatorTile key={id} ind={ind} /> : null;
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

const TILE_BG = { red: "bg-bad/5 border-bad/30", amber: "bg-warn/5 border-warn/30", green: "bg-ok/5 border-ok/30" } as const;

function IndicatorTile({ ind }: { ind: Indicator }) {
  return (
    <div className={`rounded-xl border p-3 ${TILE_BG[ind.status]}`} data-indicator-id={ind.id}>
      <div className="flex items-start justify-between gap-1">
        <p className="text-xs font-medium leading-tight text-navy">{ind.label}</p>
        <StatusIcon status={ind.status} />
      </div>
      <MetricValue metric={ind.value} className="mt-1 text-[28px] font-semibold leading-tight text-navy" />
      <div>
        <StatusPill status={ind.status} />
      </div>
      <p className="mt-1 text-[11px] leading-snug text-muted">{ind.reason}</p>
    </div>
  );
}

const ACCOUNT_KIND: Record<Account["type"], string> = {
  checking: "Checking",
  savings: "Savings",
  cd: "CD",
  ira: "Retirement",
  auto_loan: "Auto loan",
  personal_loan: "Personal loan",
  credit_card: "Credit card",
  mortgage: "Mortgage",
};

function accountDetail(a: Account) {
  if (a.type === "credit_card" && a.limit) return `${Math.round((a.balance / a.limit) * 100)}% of ${usd(a.limit)} limit`;
  if (a.type === "cd" && a.maturity_date) return `Matures ${shortDate(a.maturity_date, true)}`;
  if (a.rate != null && (a.group === "debt")) return `${a.rate}% APR`;
  if (a.monthly_contribution) return `+${usd(a.monthly_contribution)}/mo automatic`;
  return a.institution;
}

function Accounts() {
  const profile = useApp((s) => s.profile)!;
  const byId = new Map(profile.accounts.map((a) => [a.id, a]));
  return (
    <div>
      <SectionTitle right={<span className="text-xs text-muted">{profile.accounts.length} accounts</span>}>Your accounts</SectionTitle>
      <div className="space-y-2">
        {profile.groups.map((g) => (
          <Card key={g.group} className="p-3">
            <div className="flex items-baseline justify-between">
              <h3 className="text-sm font-semibold text-navy">{g.label}</h3>
              <MetricValue metric={g.total} className="text-lg font-semibold text-navy" />
            </div>
            <ul className="mt-1 divide-y divide-line">
              {g.account_ids.map((id) => {
                const a = byId.get(id);
                if (!a) return null;
                return (
                  <li key={id} className="flex items-center justify-between py-1.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-navy">
                        {a.name} <span className="text-xs text-muted">· {ACCOUNT_KIND[a.type]}</span>
                      </p>
                      <p className="truncate text-xs text-muted">{accountDetail(a)}</p>
                    </div>
                    <NumberHook id={`account.${a.id}.balance`} className="text-sm font-medium text-navy">
                      {a.group === "debt" ? `−${usd(a.balance)}` : usd(a.balance)}
                    </NumberHook>
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}

function BillsStrip({ bills }: { bills: UpcomingBill[] }) {
  return (
    <div>
      <SectionTitle right={<span className="text-xs text-muted">{bills.length} items</span>}>Next 90 days</SectionTitle>
      <div className="phone-scroll -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {bills.map((b, i) => {
          const income = b.kind !== "bill";
          return (
            <div
              key={`${b.bill_id}-${b.date}-${i}`}
              className={`w-[104px] shrink-0 rounded-xl border p-2.5 ${income ? "border-accent/30 bg-accent-soft" : "border-line bg-surface"}`}
            >
              <p className="text-[11px] font-medium text-muted">{shortDate(b.date)}</p>
              <p className="truncate text-xs text-navy">{b.name}</p>
              <p className="tabular text-sm font-semibold text-navy">
                {income ? "+" : ""}
                {usd(b.amount)}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
