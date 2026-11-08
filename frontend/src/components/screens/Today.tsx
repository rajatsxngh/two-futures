"use client";

import type { ComponentType } from "react";
import type { Account, HealthResponse, Indicator, UpcomingBill } from "@/lib/api";
import { goTo, openConnect, showIndicators } from "@/lib/actions";
import { useApp } from "@/lib/store";
import { OrbScene } from "../Logo";
import { RepeatingCharges } from "../RepeatingCharges";
import { SetupQuestions } from "../SetupQuestions";
import {
  IconArrowRight,
  IconCar,
  IconCard,
  IconGrid,
  IconHouse,
  IconLink,
  IconLock,
  IconReceipt,
  IconRefresh,
  IconSprout,
  IconVault,
  IconWallet,
} from "../icons";
import {
  BackButton,
  Hero,
  MetricValue,
  NumberHook,
  PaperSheet,
  SectionTitle,
  StatusChip,
  StatusIcon,
  shortDate,
  statusText,
  usd,
  type StatusKind,
} from "../ui";

const BAND: Record<HealthResponse["band"], { label: string; chip: string; dot: string }> = {
  vulnerable: { label: "Vulnerable", chip: "bg-poor/[0.13] text-poor", dot: "bg-poor" },
  coping: { label: "Coping", chip: "bg-fair/[0.13] text-fair", dot: "bg-fair" },
  healthy: { label: "Healthy", chip: "bg-good/[0.13] text-good", dot: "bg-good" },
};

/** The card's utilization above this is the "needs work" side of the credit health indicator. */
const HEALTHY_UTILIZATION = 30;

export function TodayScreen() {
  const profile = useApp((s) => s.profile)!;
  const health = useApp((s) => s.health)!;
  const showTiles = useApp((s) => s.showIndicators);
  const year = useApp((s) => s.futures?.target_year ?? null);
  const hasForecast = useApp((s) => s.forecast !== null);

  if (showTiles) return <IndicatorTiles health={health} onBack={() => showIndicators(false)} />;

  const [lead, ...rest] = profile.summary;
  const band = BAND[health.band];
  return (
    <div className="flex flex-1 flex-col">
      <Hero>
        {year && <FutureCards year={year} />}

        <h1 className="text-[17px] font-medium tracking-[-0.01em] text-fog">
          {greeting()}, <span className="text-snow">{profile.customer.name}</span>
        </h1>

        <div className="mt-2 flex items-baseline gap-2">
          <MetricValue metric={health.score} animate className="text-[96px] font-medium leading-[0.92] tracking-[-0.06em] text-snow" />
          <span className="text-[22px] font-medium tracking-[-0.02em] text-smoke">/100</span>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-2.5 gap-y-2 pr-14">
          <span className={`inline-flex h-[26px] items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-semibold ${band.chip}`}>
            <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${band.dot}`} />
            {band.label}
          </span>
          <span className="text-[13px] text-smoke">Financial health · not a credit score</span>
        </div>

        <div className="mt-6 grid grid-cols-4 gap-3.5">
          {health.pillars.map((p) => {
            const v = Math.max(0, Math.min(100, Number(p.score.value ?? 0)));
            return (
              <div key={p.id} className="flex min-w-0 flex-col gap-2.5">
                <div className="flex items-baseline justify-between gap-1">
                  <span className="truncate text-[12.5px] text-fog">{p.label}</span>
                  <MetricValue metric={p.score} className="text-[15px] font-semibold text-snow" />
                </div>
                <div aria-hidden className="h-1 overflow-hidden rounded-full bg-white/[0.12]">
                  <div className="h-full rounded-full bg-snow transition-[width] duration-700 ease-out" style={{ width: `${v}%` }} />
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <button
            onClick={() => showIndicators(true)}
            className="flex h-12 items-center gap-2 rounded-full bg-snow pl-1.5 pr-3.5 text-sm font-semibold tracking-[-0.005em] text-ink transition hover:bg-white active:scale-[0.98]"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-snow">
              <IconGrid className="h-4 w-4" />
            </span>
            See all 8 indicators
          </button>
          {hasForecast && (
            <button
              onClick={() => goTo("forecast")}
              className="glass flex h-12 items-center rounded-full px-3.5 text-sm font-medium text-snow transition hover:bg-white/10 active:scale-[0.98]"
            >
              Next 12 months
            </button>
          )}
        </div>

        <Summary lead={lead} rest={rest} />
      </Hero>

      <PaperSheet label="Your accounts">
        <Accounts />
        <BillsStrip bills={profile.bills_next_90} />
        <RepeatingCharges />
        <SetupQuestions />
        {year && <MeetCard year={year} />}
      </PaperSheet>
    </div>
  );
}

function greeting() {
  // The demo's "today" is fixed, so a fixed greeting keeps runs identical.
  return "Good morning";
}

/** Two cards peeking in from the right edge: the two futures. */
function FutureCards({ year }: { year: number }) {
  return (
    <button onClick={() => goTo("futures")} aria-label={`Meet ${year}`} className="absolute -right-5 top-10 z-10 h-[108px] w-[62px]">
      <span aria-hidden className="absolute left-0 top-0 h-[92px] w-[120px] rounded-[22px] border border-white/10 bg-[#232327]" />
      <span
        aria-hidden
        className="absolute left-4 top-3.5 h-[92px] w-[120px] rounded-[22px] bg-ember shadow-[0_18px_44px_-10px_rgba(255,107,26,0.6),inset_0_1px_0_rgba(255,255,255,0.35)] transition-transform duration-300 hover:-translate-x-1"
      >
        <span className="absolute left-[23px] top-[46px] -translate-x-1/2 -translate-y-1/2 -rotate-90 whitespace-nowrap text-xs font-bold tracking-[0.16em] text-ink">
          {year}
        </span>
      </span>
    </button>
  );
}

function Summary({ lead, rest }: { lead?: string; rest: string[] }) {
  const accounts = useApp((s) => s.profile?.accounts);
  const card = accounts?.find((a) => a.type === "credit_card" && a.limit);
  const util = card?.limit ? Math.round((card.balance / card.limit) * 100) : null;
  if (!lead) return null;
  return (
    <section
      aria-label="Your summary"
      className="glass mt-6 flex flex-col gap-3.5 rounded-[26px] px-[18px] pb-4 pt-[18px] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
    >
      <p className="text-base leading-[1.42] tracking-[-0.01em] text-snow [text-wrap:pretty]">{lead}</p>
      {(rest.length > 0 || (card && util !== null)) && <div aria-hidden className="h-px bg-white/[0.08]" />}
      {card && util !== null && (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2.5">
              <span aria-hidden className="relative h-5 w-[30px] shrink-0 rounded-[5px] border border-white/[0.14] bg-[#2a2a2f]">
                <span className="absolute left-1 top-[5px] h-[5px] w-[7px] rounded-[1.5px] bg-ember" />
              </span>
              <span className="truncate text-[13.5px] text-fog">{card.name}</span>
            </span>
            <span className="tabular shrink-0 text-[17px] font-semibold text-snow">
              {util}%<span className="text-[13px] font-medium text-smoke"> of limit</span>
            </span>
          </div>
          <div aria-hidden className="h-1.5 overflow-hidden rounded-full bg-white/10">
            <div
              className={`h-full rounded-full ${util > HEALTHY_UTILIZATION ? "bg-poor" : "bg-good"}`}
              style={{ width: `${Math.min(100, Math.max(0, util))}%` }}
            />
          </div>
        </div>
      )}
      {rest.length > 0 && <p className="text-[13.5px] leading-[1.45] text-fog [text-wrap:pretty]">{rest.join(" ")}</p>}
    </section>
  );
}

// ---------------------------------------------------------------------------
// The 8 indicators (drill-down from the score)
// ---------------------------------------------------------------------------

const STRIP: Record<StatusKind, string> = { green: "bg-good", amber: "bg-fair", red: "bg-poor" };

function IndicatorTiles({ health, onBack }: { health: HealthResponse; onBack: () => void }) {
  const byId = new Map(health.indicators.map((i) => [i.id, i]));
  const counts: Record<StatusKind, number> = { green: 0, amber: 0, red: 0 };
  for (const i of health.indicators) counts[i.status] += 1;
  return (
    <div className="flex flex-1 flex-col">
      <Hero>
        <BackButton onClick={onBack} label="Today" />
        <div className="mt-[22px] flex items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[30px] font-semibold leading-[1.08] tracking-[-0.035em] text-snow">8 health indicators</h1>
            <p className="mt-2 text-sm leading-[1.45] text-fog [text-wrap:pretty]">Spend, Save, Borrow and Plan, two each. Not a credit score.</p>
          </div>
          <MetricValue metric={health.score} className="shrink-0 text-[64px] font-medium leading-[0.9] tracking-[-0.06em] text-snow" />
        </div>
        <div aria-hidden className="mt-[26px] grid grid-cols-4 gap-2.5">
          {health.pillars.map((p) => (
            <span key={p.id} className="flex gap-[3px]">
              {p.indicator_ids.map((id) => {
                const ind = byId.get(id);
                return <span key={id} className={`h-1.5 flex-1 rounded-full ${ind ? STRIP[ind.status] : "bg-white/10"}`} />;
              })}
            </span>
          ))}
        </div>
        <div className="mt-3.5 flex flex-wrap gap-x-4 gap-y-1.5 text-[12.5px] text-fog">
          {(["green", "amber", "red"] as const).map((s) =>
            counts[s] > 0 ? (
              <span key={s} className="inline-flex items-center gap-1.5">
                <StatusIcon status={s} tone="dark" className="h-3.5 w-3.5" />
                {counts[s]} {statusText[s]}
              </span>
            ) : null,
          )}
        </div>
      </Hero>

      <PaperSheet label="Indicators by pillar">
        {health.pillars.map((p, i) => (
          <div key={p.id} className={i === 0 ? "mt-3" : "mt-[22px]"}>
            <SectionTitle right={<MetricValue metric={p.score} className="text-[20px] font-semibold tracking-[-0.02em] text-ink" />}>
              {p.label}
            </SectionTitle>
            <div className="mt-2.5 grid grid-cols-2 gap-3">
              {p.indicator_ids.map((id) => {
                const ind = byId.get(id);
                return ind ? <IndicatorTile key={id} ind={ind} /> : null;
              })}
            </div>
          </div>
        ))}
      </PaperSheet>
    </div>
  );
}

function IndicatorTile({ ind }: { ind: Indicator }) {
  // "1.0 months" -> big "1.0" + small "months"; words like "Sometimes" get a smaller size to fit the tile.
  const split = ind.value.display.match(/^([\d.,]+)\s+(.+)$/);
  const numeric = /\d/.test(ind.value.display);
  return (
    <div data-indicator-id={ind.id} className="flex flex-col gap-2.5 rounded-[22px] bg-tile-2 p-4">
      <h3 className="text-[13px] font-semibold leading-snug tracking-[-0.005em] text-ink">{ind.label}</h3>
      <MetricValue
        metric={ind.value}
        className={`self-start font-semibold leading-none text-ink ${numeric ? "text-[34px] tracking-[-0.04em]" : "text-[24px] tracking-[-0.03em]"}`}
      >
        {split ? (
          <>
            <span className="tabular">{split[1]}</span>
            <span className="text-[15px] font-medium tracking-[-0.01em] text-ink-2"> {split[2]}</span>
          </>
        ) : undefined}
      </MetricValue>
      <span className="self-start">
        <StatusChip status={ind.status} />
      </span>
      <p className="text-xs leading-[1.45] text-ink-2">{ind.reason}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

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

const QUIET_TILE = "bg-tile text-ink shadow-[inset_0_0_0_1px_#e7e7ea]";
const TILE: Record<Account["type"], { cls: string; Icon: ComponentType<{ className?: string }> }> = {
  checking: { cls: "bg-ink text-snow", Icon: IconWallet },
  savings: { cls: "bg-ember text-ink", Icon: IconVault },
  cd: { cls: QUIET_TILE, Icon: IconLock },
  ira: { cls: "bg-[#e9eeff] text-[#2849d6]", Icon: IconSprout },
  auto_loan: { cls: QUIET_TILE, Icon: IconCar },
  personal_loan: { cls: QUIET_TILE, Icon: IconReceipt },
  credit_card: { cls: "bg-[#18181b] text-snow", Icon: IconCard },
  mortgage: { cls: QUIET_TILE, Icon: IconHouse },
};

function accountDetail(a: Account) {
  if (a.type === "credit_card" && a.limit) return `${Math.round((a.balance / a.limit) * 100)}% of ${usd(a.limit)} limit`;
  if (a.type === "cd" && a.maturity_date) return `Matures ${shortDate(a.maturity_date, true)}`;
  if (a.rate != null && a.group === "debt") return `${a.rate}% APR`;
  if (a.monthly_contribution) return `+${usd(a.monthly_contribution)}/mo automatic`;
  return a.institution;
}

function AccountTile({ account }: { account: Account }) {
  const { cls, Icon } = TILE[account.type];
  const highUse = account.type === "credit_card" && account.limit ? (account.balance / account.limit) * 100 > HEALTHY_UTILIZATION : false;
  return (
    <span aria-hidden className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${cls}`}>
      <Icon className="h-5 w-5" />
      {account.monthly_contribution ? (
        <span className="absolute -bottom-[3px] -right-[3px] flex h-[19px] w-[19px] items-center justify-center rounded-full bg-white text-ink shadow-[0_1px_3px_rgba(10,10,11,0.18)]">
          <IconRefresh className="h-[11px] w-[11px]" strokeWidth={2.6} />
        </span>
      ) : null}
      {highUse && <span className="absolute -bottom-px -right-px h-[13px] w-[13px] rounded-full bg-[#ef4444] shadow-[0_0_0_2.5px_#fff]" />}
    </span>
  );
}

function Accounts() {
  const profile = useApp((s) => s.profile)!;
  const byId = new Map(profile.accounts.map((a) => [a.id, a]));
  return (
    <div className="mt-[18px]">
      <SectionTitle right={<span className="text-[13px] text-ink-3">{profile.accounts.length} accounts</span>}>Your accounts</SectionTitle>
      <div className="mt-2.5">
        {profile.groups.map((g) => (
          <div key={g.group}>
            <div className="flex h-11 items-center justify-between">
              <h3 className="text-[13px] font-semibold text-ink-3">{g.label}</h3>
              <MetricValue metric={g.total} className="text-[13px] font-semibold text-ink-3" />
            </div>
            <ul>
              {g.account_ids.map((id) => {
                const a = byId.get(id);
                if (!a) return null;
                return (
                  <li key={id} className="flex h-16 items-center gap-3.5">
                    <AccountTile account={a} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-medium tracking-[-0.01em] text-ink">{a.name}</p>
                      <p className="mt-0.5 truncate text-[13px] text-ink-3">
                        {ACCOUNT_KIND[a.type]} · {accountDetail(a)}
                      </p>
                    </div>
                    <NumberHook
                      id={`account.${a.id}.balance`}
                      metric={profile.account_metrics?.find((m) => m.id === `account.${a.id}.balance`)}
                      className="shrink-0 text-base font-semibold tracking-[-0.01em] text-ink"
                    >
                      {a.group === "debt" ? `−${usd(a.balance)}` : usd(a.balance)}
                    </NumberHook>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <ConnectRow />
    </div>
  );
}

/** The way in to Plaid: connect a sandbox bank, or manage the one that's connected. */
function ConnectRow() {
  const plaid = useApp((s) => s.plaid);
  const customer = useApp((s) => s.customer);
  if (!plaid.configured && !plaid.connection) return null;
  const onSandbox = customer === "sandbox" && plaid.connection;
  const title = onSandbox ? "Manage the connected bank" : plaid.connection ? "Reconnect a bank" : "Connect a bank";
  const sub = onSandbox && plaid.connection ? `${plaid.connection.institution} · through Plaid` : "Bring in test bank data with Plaid";
  return (
    <button
      onClick={() => openConnect(true)}
      className="mt-3 flex w-full items-center gap-3.5 rounded-[22px] border border-dashed border-[#d9d9de] px-3 py-3 text-left transition hover:border-ink-3/50 hover:bg-tile-2"
    >
      <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-tile text-ink">
        <IconLink className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</span>
        <span className="block truncate text-[13px] text-ink-3">{sub}</span>
      </span>
      <span className="shrink-0 rounded-full bg-fair-soft px-2 py-1 text-[11px] font-semibold text-fair-ink">Sandbox</span>
    </button>
  );
}

function BillsStrip({ bills }: { bills: UpcomingBill[] }) {
  if (!bills.length) return null;
  return (
    <div className="mt-7">
      <SectionTitle right={<span className="text-[13px] text-ink-3">{bills.length} items</span>}>Next 90 days</SectionTitle>
      <div className="phone-scroll -mx-5 mt-3.5 flex gap-2.5 overflow-x-auto px-5 pb-0.5">
        {bills.map((b, i) => {
          const income = b.kind !== "bill";
          const d = new Date(`${b.date}T12:00:00`);
          return (
            <div
              key={`${b.bill_id}-${b.date}-${i}`}
              className={`flex w-[116px] shrink-0 flex-col gap-3 rounded-[22px] p-3.5 ${income ? "bg-ember-soft" : "bg-tile"}`}
            >
              <span className="flex items-baseline gap-1">
                <span className="text-[22px] font-semibold leading-none tracking-[-0.03em] text-ink">{d.getDate()}</span>
                <span className={`text-xs font-medium ${income ? "text-[#9a3412]" : "text-ink-3"}`}>
                  {d.toLocaleDateString("en-US", { month: "short" })}
                </span>
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-[12.5px] text-ink-2">{b.name}</span>
                <span className={`tabular text-[15px] font-semibold ${income ? "text-ember-ink" : "text-ink"}`}>
                  {income ? "+" : ""}
                  {usd(b.amount)}
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MeetCard({ year }: { year: number }) {
  return (
    <button
      onClick={() => goTo("futures")}
      className="group relative mt-3.5 block h-[176px] w-full overflow-hidden rounded-[28px] bg-obsidian text-left text-snow"
    >
      <span aria-hidden className="absolute inset-0 bg-[radial-gradient(48%_70%_at_72%_44%,rgba(255,107,26,0.2),rgba(255,107,26,0)_70%)]" />
      <OrbScene className="absolute right-0 top-0" />
      <span className="absolute left-[22px] top-[22px] flex max-w-[160px] flex-col gap-1.5">
        <span className="text-[26px] font-semibold leading-[1.1] tracking-[-0.03em]">Meet {year}</span>
        <span className="text-sm leading-[1.4] text-fog">Talk to two versions of future you</span>
      </span>
      <span
        aria-hidden
        className="absolute bottom-5 left-[22px] flex h-12 w-12 items-center justify-center rounded-full bg-snow text-ink transition-transform group-hover:translate-x-0.5"
      >
        <IconArrowRight className="h-5 w-5" strokeWidth={1.9} />
      </span>
    </button>
  );
}
