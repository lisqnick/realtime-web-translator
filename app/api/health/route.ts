import { NextResponse } from "next/server";

import { serverEnv } from "@/config/env";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      status: "ok",
      timestamp: new Date().toISOString(),
      services: {
        realtimeSessionRoute: true,
        openAiApiKeyConfigured: Boolean(serverEnv.openAiApiKey),
      },
    },
    {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
