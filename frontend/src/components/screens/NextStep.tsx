"use client";

import type { CSSProperties } from "react";
import type { Account, Metric, TransferResponse } from "@/lib/api";
import { proposeTransfer, stopTransfer } from "@/lib/actions";
import { useApp } from "@/lib/store";
import { FREQUENCY_TEXT } from "../TransferSheet";
import { ACCOUNT_ICON, IconArrowRight, IconBank, IconCheck } from "../icons";
import { Hero, MetricValue, PaperSheet, SectionTitle, longDate, usd } from "../ui";

export function NextStepScreen() {
  const futures = useApp((s) => s.futures)!;
  const profile = useApp((s) => s.profile)!;
  const transfer = useApp((s) => s.transfer);
  const step = futures.next_step;
  const accountOf = (id: string) => profile.accounts.find((a) => a.id === id);
  const action = futures.plan.actions.find((a) => a.id === step.action_id);
  // "none": the plan has no automatic transfer to start (e.g. a connected bank whose checking already runs short).
  const noTransfer = step.action_id === "none";
  const scheduled = transfer?.status === "scheduled";
  const others = futures.plan.actions.filter((a) => a.id !== step.action_id);

  return (
    <div className="flex flex-1 flex-col">
      <Hero>
        <h1 className="text-[30px] font-semibold leading-[1.08] tracking-[-0.035em] text-snow">Your next step</h1>
        <p className="mt-2 text-sm text-fog">One small move that starts the plan.</p>

        <section
          aria-label="Step 1 of the plan"
          className="relative mt-[22px] rounded-[30px] border border-ember/30 bg-[linear-gradient(180deg,rgba(255,107,26,0.13)_0%,rgba(255,255,255,0.04)_46%,rgba(255,255,255,0.035)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
        >
          <p className="text-[12.5px] font-semibold text-ember-text">Step 1 of the plan</p>
          <h2 className="mt-2 text-[24px] font-semibold leading-[1.2] tracking-[-0.03em] text-snow [text-wrap:balance]">{step.title}</h2>
          {action && <p className="mt-2.5 text-sm leading-[1.5] text-fog [text-wrap:pretty]">{action.description}</p>}

          {!noTransfer && (
            <>
              <div className="mt-[18px] flex flex-wrap items-baseline gap-x-2.5">
                {step.amount_metric ? (
                  <MetricValue metric={step.amount_metric} className="text-[80px] font-medium leading-[0.95] tracking-[-0.06em] text-snow" />
                ) : (
                  <span className="tabular text-[80px] font-medium leading-[0.95] tracking-[-0.06em] text-snow">{usd(step.amount)}</span>
                )}
                <span className="text-base text-fog">{FREQUENCY_TEXT[step.frequency].toLowerCase()}</span>
              </div>
              <TransferFlow from={accountOf(step.from_account_id)} to={accountOf(step.to_account_id)} live={scheduled} />
            </>
          )}

          {step.effects.length > 0 && (
            <div className="mt-[18px] grid grid-cols-2 gap-2.5">
              {step.effects.map((m) => (
                <Effect key={m.id} metric={m} />
              ))}
            </div>
          )}

          {noTransfer ? null : scheduled ? (
            <ScheduledBadge transfer={transfer!} />
          ) : (
            <>
              {transfer?.status === "stopped" && (
                <p className="mt-4 text-center text-sm text-fog" aria-live="polite">
                  {transfer.sentence}
                </p>
              )}
              <button
                onClick={() =>
                  proposeTransfer(
                    { amount: step.amount, from_account_id: step.from_account_id, to_account_id: step.to_account_id, frequency: step.frequency },
                    "tap",
                  )
                }
                className="mt-[18px] flex h-[58px] w-full items-center justify-center gap-2.5 rounded-full bg-ember text-[17px] font-semibold tracking-[-0.01em] text-ink shadow-[0_16px_40px_-14px_rgba(255,107,26,0.8),inset_0_1px_0_rgba(255,255,255,0.35)] transition hover:brightness-105 active:scale-[0.99]"
              >
                Start this
                <IconArrowRight className="h-[18px] w-[18px]" strokeWidth={2.1} />
              </button>
            </>
          )}
        </section>
      </Hero>

      <PaperSheet label="Then the plan does this">
        {others.length > 0 && (
          <>
            <SectionTitle className="mt-[18px]">Then the plan does this</SectionTitle>
            <div className="relative mt-5">
              <span aria-hidden className="absolute bottom-4 left-[15px] top-4 w-0.5 rounded-full bg-[#efeff1]" />
              <ol className="relative flex flex-col gap-[22px]">
                {others.map((a, i) => (
                  <li key={a.id} className="flex gap-4">
                    <span
                      className={`tabular flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold ${
                        i === others.length - 1 ? "bg-ink text-snow" : "bg-white text-ink shadow-[inset_0_0_0_1.5px_#e4e4e7]"
                      }`}
                    >
                      {a.rule}
                    </span>
                    <span className="flex min-w-0 flex-col gap-1 pt-[5px]">
                      <span className="text-[15px] font-semibold leading-[1.3] tracking-[-0.01em] text-ink">{a.title}</span>
                      <span className="text-[13px] leading-[1.45] text-ink-3">{a.description}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </>
        )}
      </PaperSheet>
    </div>
  );
}

/** "Spend → Reserve": the two accounts, with a spark travelling between them (always moving once scheduled). */
function TransferFlow({ from, to, live }: { from?: Account; to?: Account; live: boolean }) {
  const dash: CSSProperties = {
    backgroundImage: `linear-gradient(90deg, ${live ? "rgba(255,107,26,0.6)" : "rgba(255,255,255,0.28)"} 50%, transparent 50%)`,
    backgroundSize: "8px 2px",
  };
  return (
    <div className="mt-5 flex items-center gap-2.5">
      <AccountChip account={from} tile="bg-[#2a2a2f] text-snow" />
      <span aria-hidden className="relative h-0.5 min-w-6 flex-1" style={dash}>
        <span className="absolute -top-[3px] -ml-1 h-2 w-2 animate-flow rounded-full bg-ember shadow-[0_0_12px_rgba(255,107,26,0.9)]" />
      </span>
      <AccountChip account={to} tile="bg-ember text-ink" />
    </div>
  );
}

function AccountChip({ account, tile }: { account?: Account; tile: string }) {
  const Icon = (account && ACCOUNT_ICON[account.type]) || IconBank;
  return (
    <span className="glass flex h-12 min-w-0 max-w-[46%] shrink items-center gap-[9px] rounded-full pl-2 pr-3.5">
      <span aria-hidden className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${tile}`}>
        <Icon className="h-4 w-4" />
      </span>
      <span className="flex min-w-0 flex-col leading-[1.15]">
        <span className="truncate text-sm font-semibold text-snow">{account?.name ?? "Account"}</span>
        {account && <span className="tabular truncate text-[11.5px] text-smoke">{usd(account.balance)}</span>}
      </span>
    </span>
  );
}

/** An effect like "92 vs 73": the first figure big, the comparison small. */
function Effect({ metric }: { metric: Metric }) {
  const [lead, ...rest] = metric.display.split(" ");
  return (
    <div className="glass flex min-w-0 flex-col gap-2 rounded-[20px] p-3.5">
      <span className="text-xs leading-tight text-fog">{metric.label}</span>
      <MetricValue metric={metric} className="self-start">
        <span className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="tabular text-[30px] font-semibold leading-none tracking-[-0.045em] text-snow">{lead}</span>
          {rest.length > 0 && <span className="tabular text-[13px] text-smoke">{rest.join(" ")}</span>}
        </span>
      </MetricValue>
    </div>
  );
}

function ScheduledBadge({ transfer }: { transfer: TransferResponse }) {
  const pending = useApp((s) => s.transferPending);
  const error = useApp((s) => s.error);
  return (
    <div className="mt-5 flex flex-col items-center border-t border-white/[0.08] pt-[22px] text-center" aria-live="polite">
      <span className="pop-in inline-flex h-[42px] items-center gap-[9px] rounded-full bg-snow pl-2 pr-[18px] text-[15px] font-semibold text-ink shadow-[0_12px_34px_-12px_rgba(255,107,26,0.7)]">
        <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-full bg-ember text-ink">
          <IconCheck className="h-[15px] w-[15px]" strokeWidth={2.6} />
        </span>
        Scheduled · simulated
      </span>
      <p className="mt-4 max-w-[290px] text-[15px] leading-[1.45] text-snow [text-wrap:balance]">{transfer.sentence}</p>
      <p className="mt-1.5 text-[13px] text-smoke">First transfer {longDate(transfer.first_date)}</p>
      {error && <p className="mt-1 text-sm text-poor">{error}</p>}
      <button
        onClick={() => void stopTransfer()}
        disabled={pending}
        className="glass mt-3.5 h-11 rounded-full px-[22px] text-sm font-semibold text-snow transition hover:bg-white/10 disabled:opacity-50"
      >
        {pending ? "Stopping…" : "Stop"}
      </button>
    </div>
  );
}
