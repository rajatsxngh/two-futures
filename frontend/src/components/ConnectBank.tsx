"use client";

/**
 * "Connect a bank (sandbox)": Plaid Link in test mode, and the "Sandbox · test bank data" label.
 *
 * The browser only ever gets a short-lived link_token from our server and hands Plaid's public_token
 * back to it. The server does every Plaid call, keeps the access token, and turns the bank's data into
 * a customer the engine runs on (customer id "sandbox"). The test login is typed by the user, in Plaid's
 * own window; this app never sees it.
 */
import { useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { api, ApiError, type PlaidConnection } from "@/lib/api";
import { disconnectBank, finishConnect, openConnect, refreshPlaid } from "@/lib/actions";
import { useApp } from "@/lib/store";
import { Logo } from "./Logo";
import { ACCOUNT_ICON, IconBank, IconLink, IconShield } from "./icons";
import { StatusIcon, usd } from "./ui";

type Phase = "idle" | "token" | "link" | "pulling" | "error";

const STEPS = [
  "Plaid opens in its own window.",
  "Pick any bank, then sign in with the test login Plaid shows on that screen.",
  "We pull the accounts and up to 24 months of transactions, and add “Sandbox bank” to the customer picker.",
];

const DEBT = new Set(["auto_loan", "personal_loan", "credit_card", "mortgage"]);

export function ConnectSheet() {
  const open = useApp((s) => s.connectOpen);
  const plaid = useApp((s) => s.plaid);
  const [phase, setPhase] = useState<Phase>("idle");
  const [token, setToken] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void refreshPlaid();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;
  const busy = phase === "token" || phase === "link" || phase === "pulling";

  function close() {
    if (phase === "pulling") return; // the server is building the customer; let it finish
    setPhase("idle");
    setToken(null);
    setMessage(null);
    openConnect(false);
  }

  async function start() {
    setMessage(null);
    setPhase("token");
    try {
      const { link_token } = await api.plaidLinkToken();
      setToken(link_token);
      setPhase("link");
    } catch (e) {
      setPhase("error");
      setMessage(e instanceof ApiError ? e.detail : "Couldn't start the bank connection.");
    }
  }

  async function onPublicToken(publicToken: string) {
    setToken(null);
    setPhase("pulling");
    try {
      await finishConnect(publicToken);
      setPhase("idle");
    } catch (e) {
      setPhase("error");
      setMessage(e instanceof ApiError ? e.detail : "Couldn't connect the bank.");
    }
  }

  function onExit(errorText: string | null) {
    setToken(null);
    setPhase(errorText ? "error" : "idle");
    setMessage(errorText);
  }

  const connection = plaid.connection;
  const primary = phase === "token" || phase === "link" ? "Opening Plaid…" : phase === "pulling" ? "Connecting…" : "Open Plaid";

  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-end">
      <button aria-label="Close" className="fade-in absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={close} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Connect a bank (sandbox)"
        className="sheet-up relative flex max-h-[90%] flex-col rounded-t-[32px] bg-white text-ink shadow-[0_-24px_60px_rgba(0,0,0,0.45)]"
      >
        <div className="phone-scroll overflow-y-auto px-5 pb-4 pt-2.5">
          <div aria-hidden className="mx-auto h-[5px] w-10 rounded-full bg-hair" />
          <div className="mt-4 flex items-center justify-between gap-3">
            <h2 className="text-[24px] font-semibold tracking-[-0.03em]">Connect a bank</h2>
            <SandboxBadge />
          </div>

          <LinkVisual moving={busy} institution={phase === "pulling" ? undefined : connection?.institution} />

          <p className="mt-4 text-[15px] leading-[1.5] text-ink-2 [text-wrap:pretty]">
            See the same score, forecast and futures on bank data shaped like any real bank&apos;s. This uses Plaid&apos;s sandbox: test banks and
            test accounts, never real ones.
          </p>

          {phase === "pulling" && (
            <div role="status" className="mt-4 rounded-[22px] bg-ember-soft p-4">
              <p className="text-sm font-semibold text-ink">Pulling accounts and transactions from the test bank and building the customer.</p>
              <p className="mt-1 text-[13px] text-ink-2">This can take about 20 seconds…</p>
              <div aria-hidden className="mt-3 h-1.5 overflow-hidden rounded-full bg-white">
                <div className="h-full w-1/3 animate-indeterminate rounded-full bg-ember" />
              </div>
            </div>
          )}

          {connection && phase !== "pulling" && <ConnectedCard connection={connection} />}

          <ol className="mt-4 flex flex-col gap-3">
            {STEPS.map((s, i) => (
              <li key={s} className="flex gap-3.5">
                <span className="tabular flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-tile text-[13px] font-semibold">{i + 1}</span>
                <span className="pt-[3px] text-sm leading-[1.45] text-ink">{s}</span>
              </li>
            ))}
          </ol>

          <div className="mt-4 flex gap-2.5 rounded-[18px] bg-tile-2 px-3.5 py-3 text-[12.5px] leading-[1.45] text-ink-3">
            <IconShield className="mt-px h-4 w-4 shrink-0 text-[#71717a]" strokeWidth={1.7} />
            <span>
              You sign in inside Plaid&apos;s window, so this app never sees the login. Anything the bank doesn&apos;t send (like a card&apos;s APR)
              gets a default, and every default is listed under &ldquo;show the math&rdquo;.
            </span>
          </div>

          {plaid.configured === false && (
            <p role="status" className="mt-3 rounded-[18px] border border-hair px-3.5 py-3 text-sm leading-snug text-ink">
              Bank connection is off on this server. {plaid.reason}
            </p>
          )}
          {message && (
            <p role="alert" className="mt-3 rounded-[18px] bg-poor-soft px-3.5 py-3 text-sm leading-snug text-poor-ink">
              {message}
            </p>
          )}
        </div>

        <div className="border-t border-[#f0f0f2] px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-3.5">
          <div className="grid grid-cols-2 gap-2.5">
            <button
              onClick={close}
              disabled={phase === "pulling"}
              className="h-14 rounded-full border border-hair bg-white text-[15px] font-semibold text-ink transition hover:border-ink-3/40 disabled:opacity-50"
            >
              Not now
            </button>
            <button
              onClick={() => void start()}
              disabled={busy || plaid.configured !== true}
              className="flex h-14 items-center justify-center gap-2 rounded-full bg-ink text-[15px] font-semibold text-snow transition hover:bg-black disabled:opacity-40"
            >
              <IconLink className="h-[18px] w-[18px]" />
              {primary}
            </button>
          </div>
          {connection && phase !== "pulling" && (
            <button
              onClick={() => void disconnectBank().then(close)}
              className="mt-1.5 h-11 w-full text-center text-[13px] font-medium text-ink-3 transition hover:text-poor-ink"
            >
              Disconnect the sandbox bank
            </button>
          )}
        </div>
      </div>
      {token && <LinkOpener token={token} onPublicToken={onPublicToken} onExit={onExit} />}
    </div>
  );
}

/** The bank, Plaid in the middle, and us: a spark travels the line while connecting. */
function LinkVisual({ moving, institution }: { moving: boolean; institution?: string }) {
  return (
    <div aria-hidden className="mt-5 flex items-center justify-center gap-3 rounded-[24px] bg-tile-2 px-4 py-5">
      <span className="flex w-20 flex-col items-center gap-2">
        <span className="flex h-14 w-14 items-center justify-center rounded-[18px] bg-white text-ink shadow-[0_6px_16px_-8px_rgba(10,10,11,0.3),inset_0_0_0_1px_#e7e7ea]">
          <IconBank className="h-6 w-6" strokeWidth={1.7} />
        </span>
        <span className="max-w-full truncate text-[11.5px] font-medium text-ink-3">{institution ?? "Test bank"}</span>
      </span>
      <span className="relative mb-6 flex flex-1 items-center">
        <span className="h-0.5 w-full" style={{ backgroundImage: "linear-gradient(90deg, #c4c4ca 50%, transparent 50%)", backgroundSize: "7px 2px" }} />
        {moving && <span className="absolute -top-[3px] -ml-1 h-2 w-2 animate-flow rounded-full bg-ember shadow-[0_0_10px_rgba(255,107,26,0.8)]" />}
        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink px-2.5 py-1 text-[11px] font-semibold tracking-[0.02em] text-snow">
          Plaid
        </span>
      </span>
      <span className="flex w-20 flex-col items-center gap-2">
        <Logo variant="icon" size={56} />
        <span className="text-[11.5px] font-medium text-ink-3">Two Futures</span>
      </span>
    </div>
  );
}

function ConnectedCard({ connection }: { connection: PlaidConnection }) {
  const months = Math.round(connection.history_days / 30.4);
  return (
    <section aria-label="Connected bank" className="mt-4 rounded-[22px] border border-hair p-4">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-good-ink">
        <StatusIcon status="green" className="h-3.5 w-3.5" />
        Connected now
      </p>
      <p className="mt-1 truncate text-[17px] font-semibold tracking-[-0.01em]">{connection.institution}</p>
      <p className="mt-0.5 text-xs leading-snug text-ink-3">
        {connection.accounts.length} accounts · {connection.transactions.toLocaleString()} transactions · {months} month{months === 1 ? "" : "s"} of history
      </p>
      <ul className="mt-2.5">
        {connection.accounts.map((a) => {
          const Icon = ACCOUNT_ICON[a.type] ?? IconBank;
          return (
            <li key={a.id} className="flex min-h-12 items-center gap-3 border-t border-[#f0f0f2]">
              <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-tile text-ink">
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{a.name}</span>
              <span className="tabular shrink-0 text-sm font-semibold">{DEBT.has(a.type) ? `−${usd(a.balance)}` : usd(a.balance)}</span>
            </li>
          );
        })}
      </ul>
      {connection.note && <p className="mt-2 text-xs leading-snug text-ink-3">{connection.note}</p>}
      <p className="mt-2 text-xs text-ink-3">Connecting again replaces it.</p>
    </section>
  );
}

/** Opens Plaid Link as soon as its script is ready (react-plaid-link loads Plaid's own script). */
function LinkOpener({
  token,
  onPublicToken,
  onExit,
}: {
  token: string;
  onPublicToken: (publicToken: string) => void;
  onExit: (errorText: string | null) => void;
}) {
  const { open, ready, error } = usePlaidLink({
    token,
    onSuccess: (publicToken) => {
      if (publicToken) onPublicToken(publicToken);
      else onExit("Plaid didn't return a connection. Try again.");
    },
    onExit: (err) => onExit(err ? err.display_message || err.error_message || "The bank connection was closed." : null),
  });
  useEffect(() => {
    if (ready) open();
  }, [ready, open]);
  useEffect(() => {
    if (error) onExit("Plaid couldn't load. Check the internet connection and try again.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);
  return null;
}

/** On paper: the sheet's sandbox label. */
export function SandboxBadge() {
  return (
    <span className="inline-flex h-7 shrink-0 items-center rounded-full bg-fair-soft px-2.5 text-[11.5px] font-semibold text-fair-ink">
      Sandbox · test bank data
    </span>
  );
}

/** Shown in the header whenever the connected sandbox customer is on screen. */
export function SandboxBanner() {
  const customer = useApp((s) => s.customer);
  const connection = useApp((s) => s.plaid.connection);
  const unavailable = useApp((s) => s.unavailable);
  if (customer !== "sandbox") return null;
  return (
    <div className="glass mx-4 mb-3 rounded-2xl py-1 pl-3 pr-1">
      <div className="flex items-center justify-between gap-2.5">
        <span className="shrink-0 rounded-full bg-fair/[0.14] px-2 py-0.5 text-[11px] font-semibold text-fair">Sandbox · test data</span>
        <span className="min-w-0 flex-1 truncate text-xs text-fog">
          {connection ? `${connection.institution} · ${connection.accounts.length} accounts · Plaid` : "Plaid"}
        </span>
        <button onClick={() => openConnect(true)} className="h-11 shrink-0 rounded-full px-3 text-xs font-semibold text-ember-text transition hover:bg-white/[0.06]">
          Manage
        </button>
      </div>
      {unavailable && <p className="pb-2 pr-2 text-xs leading-snug text-fog">{unavailable}</p>}
    </div>
  );
}
