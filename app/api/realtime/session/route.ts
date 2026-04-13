import { NextResponse } from "next/server";

import { createRealtimeSession, RealtimeSessionCreationError } from "@/lib/openai/realtime-session";
import { isSupportedLanguageCode } from "@/lib/languages/config";
import type { ApiErrorResponse, RealtimeSessionRequest } from "@/types/realtime";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let payload: RealtimeSessionRequest = {};

  try {
    payload = (await request.json()) as RealtimeSessionRequest;
  } catch {
    return NextResponse.json<ApiErrorResponse>(
      {
        ok: false,
        error: {
          code: "invalid_json",
          message: "请求体必须是合法 JSON。",
          status: 400,
        },
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (payload.sourceLanguage && !isSupportedLanguageCode(payload.sourceLanguage)) {
    return NextResponse.json<ApiErrorResponse>(
      {
        ok: false,
        error: {
          code: "unsupported_source_language",
          message: "sourceLanguage 不在当前支持范围内。",
          status: 400,
        },
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const session = await createRealtimeSession({
      sourceLanguage: payload.sourceLanguage,
    });

    return NextResponse.json(session, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof RealtimeSessionCreationError) {
      return NextResponse.json<ApiErrorResponse>(
        {
          ok: false,
          error: {
            code: error.code,
            message: error.message,
            status: error.status,
            requestId: error.requestId,
          },
        },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json<ApiErrorResponse>(
      {
        ok: false,
        error: {
          code: "unexpected_realtime_session_error",
          message: "创建 Realtime 会话时发生未预期错误。",
          status: 500,
        },
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
