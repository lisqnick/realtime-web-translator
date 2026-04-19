import { NextResponse } from "next/server";

import { createRealtimeSession, RealtimeSessionCreationError } from "@/lib/openai/realtime-session";
import {
  isBidirectionalAutoLanguagePairSupported,
  isSupportedLanguageCode,
} from "@/lib/languages/config";
import type { TranslationDirectionMode } from "@/types/config";
import type {
  ApiErrorResponse,
  AudioRuntimeMode,
  RealtimeSessionRequest,
} from "@/types/realtime";

export const runtime = "nodejs";

function normalizeAudioRuntimeMode(value: string | undefined): AudioRuntimeMode {
  return value === "noisy" ? "noisy" : "normal";
}

function normalizeDirectionMode(value: string | undefined): TranslationDirectionMode {
  return value === "auto_selected_pair" ? "auto_selected_pair" : "fixed";
}

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

  if (payload.targetLanguage && !isSupportedLanguageCode(payload.targetLanguage)) {
    return NextResponse.json<ApiErrorResponse>(
      {
        ok: false,
        error: {
          code: "unsupported_target_language",
          message: "targetLanguage 不在当前支持范围内。",
          status: 400,
        },
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const directionMode = normalizeDirectionMode(payload.directionMode);

  if (directionMode === "fixed" && !payload.sourceLanguage) {
    return NextResponse.json<ApiErrorResponse>(
      {
        ok: false,
        error: {
          code: "missing_source_language",
          message: "fixed 模式下必须提供 sourceLanguage。",
          status: 400,
        },
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (
    directionMode === "auto_selected_pair" &&
    (!payload.sourceLanguage ||
      !payload.targetLanguage ||
      !isBidirectionalAutoLanguagePairSupported(
        payload.sourceLanguage,
        payload.targetLanguage,
      ))
  ) {
    return NextResponse.json<ApiErrorResponse>(
      {
        ok: false,
        error: {
          code: "unsupported_auto_language_pair",
          message: "当前自动互译语言对不在支持范围内。",
          status: 400,
        },
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const session = await createRealtimeSession({
      directionMode,
      sourceLanguage: payload.sourceLanguage,
      targetLanguage: payload.targetLanguage,
      audioRuntimeMode: normalizeAudioRuntimeMode(payload.audioRuntimeMode),
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
