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
import { api, ApiError } from "@/lib/api";
import { disconnectBank, finishConnect, openConnect, refreshPlaid } from "@/lib/actions";
import { useApp } from "@/lib/store";

type Phase = "idle" | "token" | "link" | "pulling" | "error";

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
  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-end">
      <button aria-label="Close" className="fade-in absolute inset-0 bg-navy/30" onClick={close} />
      <div role="dialog" aria-modal="true" aria-label="Connect a bank (sandbox)" className="sheet-up relative rounded-t-3xl bg-white px-4 pb-5 pt-3 shadow-2xl">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" />
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-navy">Connect a bank</h2>
          <SandboxBadge />
        </div>
        <p className="mt-1 text-sm leading-snug text-navy/85">
          See the same score, forecast and futures on bank data shaped like any real bank&apos;s. This uses Plaid&apos;s
          sandbox: test banks and test accounts, never real ones.
        </p>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-navy/85">
          <li>Plaid opens in its own window.</li>
          <li>Pick any bank, then sign in with the test login Plaid shows on that screen.</li>
          <li>We pull the accounts and up to 24 months of transactions, and add &ldquo;Sandbox bank&rdquo; to the customer picker.</li>
        </ol>
        <p className="mt-2 text-xs text-muted">
          Anything the bank doesn&apos;t send (like a card&apos;s APR) gets a default, and every default is listed under &ldquo;show the math&rdquo;.
        </p>

        {plaid.configured === false && (
          <p role="status" className="mt-3 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-navy">
            Bank connection is off on this server. {plaid.reason}
          </p>
        )}
        {connection && phase !== "pulling" && (
          <p className="mt-3 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-navy">
            Connected now: {connection.institution} ({connection.accounts.length} accounts). Connecting again replaces it.
          </p>
        )}
        {phase === "pulling" && (
          <p role="status" className="mt-3 rounded-xl bg-accent-soft px-3 py-2 text-sm text-navy">
            Pulling accounts and transactions from the test bank and building the customer. This can take about 20 seconds...
          </p>
        )}
        {message && <p role="alert" className="mt-3 text-sm text-bad">{message}</p>}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button onClick={close} disabled={phase === "pulling"} className="rounded-2xl border border-line py-3 text-sm font-semibold text-navy disabled:opacity-50">
            Not now
          </button>
          <button
            onClick={() => void start()}
            disabled={busy || plaid.configured !== true}
            className="rounded-2xl bg-accent py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {phase === "token" || phase === "link" ? "Opening Plaid..." : phase === "pulling" ? "Connecting..." : "Open Plaid"}
          </button>
        </div>
        {connection && phase !== "pulling" && (
          <button onClick={() => void disconnectBank().then(close)} className="mt-2 w-full py-1 text-center text-xs font-medium text-muted hover:text-navy">
            Disconnect the sandbox bank
          </button>
        )}
      </div>
      {token && <LinkOpener token={token} onPublicToken={onPublicToken} onExit={onExit} />}
    </div>
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

export function SandboxBadge() {
  return (
    <span className="shrink-0 rounded-full border border-warn/40 bg-warn/10 px-2 py-0.5 text-[11px] font-semibold text-warn">
      Sandbox · test bank data
    </span>
  );
}

/** Shown under the header whenever the connected sandbox customer is on screen. */
export function SandboxBanner() {
  const customer = useApp((s) => s.customer);
  const connection = useApp((s) => s.plaid.connection);
  const unavailable = useApp((s) => s.unavailable);
  if (customer !== "sandbox") return null;
  return (
    <div className="border-b border-line bg-surface px-4 py-1.5 text-xs text-navy">
      <div className="flex items-center justify-between gap-2">
        <SandboxBadge />
        <span className="truncate text-muted">
          {connection ? `${connection.institution} · ${connection.accounts.length} accounts · Plaid` : "Plaid"}
        </span>
        <button onClick={() => openConnect(true)} className="shrink-0 font-medium text-accent">
          Manage
        </button>
      </div>
      {unavailable && <p className="mt-1 leading-snug text-muted">{unavailable}</p>}
    </div>
  );
}
