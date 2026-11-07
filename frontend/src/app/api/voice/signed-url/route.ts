/**
 * Server-only: trades our ElevenLabs API key for a short-lived signed URL the
 * browser can use to open one conversation with the Future Maya agent.
 *
 *   GET /api/voice/signed-url          -> { signedUrl }            (200)
 *   GET /api/voice/signed-url?check=1  -> { configured, missing }  (200, no ElevenLabs call)
 *
 * The key never leaves the server. This file route wins over the /api/* rewrite
 * to FastAPI in next.config.ts.
 */
import { connection } from "next/server";

const ELEVENLABS_SIGNED_URL = "https://api.elevenlabs.io/v1/convai/conversation/get-signed-url";

function missingVars(): string[] {
  const missing: string[] = [];
  if (!process.env.ELEVENLABS_API_KEY) missing.push("ELEVENLABS_API_KEY");
  if (!process.env.ELEVENLABS_AGENT_ID) missing.push("ELEVENLABS_AGENT_ID");
  return missing;
}

export async function GET(request: Request) {
  // Read env at request time, never at build time.
  await connection();

  const missing = missingVars();
  const check = new URL(request.url).searchParams.has("check");

  if (check) {
    return Response.json({ configured: missing.length === 0, missing }, { headers: { "Cache-Control": "no-store" } });
  }

  if (missing.length > 0) {
    return Response.json(
      { error: "missing_config", missing, detail: `Add ${missing.join(" and ")} to frontend/.env.local` },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const url = `${ELEVENLABS_SIGNED_URL}?agent_id=${encodeURIComponent(process.env.ELEVENLABS_AGENT_ID!)}`;
  try {
    const res = await fetch(url, {
      headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY! },
      cache: "no-store",
    });
    if (!res.ok) {
      // Don't echo ElevenLabs' body: keep the response free of anything key-related.
      return Response.json(
        { error: "elevenlabs_error", detail: `ElevenLabs returned ${res.status} for the signed URL` },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }
    const body = (await res.json()) as { signed_url?: string };
    if (!body.signed_url) {
      return Response.json(
        { error: "elevenlabs_error", detail: "ElevenLabs response had no signed_url" },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }
    return Response.json({ signedUrl: body.signed_url }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(
      { error: "network_error", detail: "Could not reach ElevenLabs" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
