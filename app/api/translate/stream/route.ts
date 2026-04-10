import { NextResponse } from "next/server";

import { isSupportedLanguageCode } from "@/lib/languages/config";
import {
  streamTranslationResponse,
  TranslationStreamError,
} from "@/lib/openai/translation-stream";
import { isScenarioId } from "@/lib/scenarios/config";
import type { ApiErrorResponse } from "@/types/realtime";
import type { TranslationStreamRequest, TranslationStreamEvent } from "@/types/translation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let payload: TranslationStreamRequest | null = null;

  try {
    payload = (await request.json()) as TranslationStreamRequest;
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

  const validationError = validateTranslationRequest(payload);

  if (validationError) {
    return NextResponse.json<ApiErrorResponse>(
      {
        ok: false,
        error: validationError,
      },
      { status: validationError.status ?? 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const writeEvent = (event: TranslationStreamEvent) => {
        controller.enqueue(
          encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
        );
      };

      writeEvent({
        type: "translation.started",
        segmentId: payload.segmentId,
        revision: payload.revision,
      });

      try {
        let accumulatedText = "";

        for await (const event of streamTranslationResponse(payload, { signal: request.signal })) {
          if (event.kind === "delta") {
            accumulatedText += event.delta;
            writeEvent({
              type: "translation.delta",
              segmentId: payload.segmentId,
              revision: payload.revision,
              delta: event.delta,
              text: accumulatedText,
            });
            continue;
          }

          if (event.kind === "completed") {
            writeEvent({
              type: "translation.completed",
              segmentId: payload.segmentId,
              revision: payload.revision,
              text: event.text,
            });
            continue;
          }

          writeEvent({
            type: "translation.error",
            segmentId: payload.segmentId,
            revision: payload.revision,
            message: event.message,
          });
        }
      } catch (error) {
        const message =
          error instanceof TranslationStreamError
            ? error.message
            : error instanceof Error
              ? error.message
              : "翻译流发生未知错误。";

        writeEvent({
          type: "translation.error",
          segmentId: payload.segmentId,
          revision: payload.revision,
          message,
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}

function validateTranslationRequest(payload: TranslationStreamRequest | null) {
  if (!payload) {
    return {
      code: "missing_payload",
      message: "缺少翻译请求参数。",
      status: 400,
    };
  }

  if (!isSupportedLanguageCode(payload.sourceLanguage)) {
    return {
      code: "unsupported_source_language",
      message: "sourceLanguage 不在当前支持范围内。",
      status: 400,
    };
  }

  if (!isSupportedLanguageCode(payload.targetLanguage)) {
    return {
      code: "unsupported_target_language",
      message: "targetLanguage 不在当前支持范围内。",
      status: 400,
    };
  }

  if (!payload.text?.trim()) {
    return {
      code: "missing_text",
      message: "text 不能为空。",
      status: 400,
    };
  }

  if (!payload.segmentId?.trim()) {
    return {
      code: "missing_segment_id",
      message: "segmentId 不能为空。",
      status: 400,
    };
  }

  if (!Number.isInteger(payload.revision) || payload.revision <= 0) {
    return {
      code: "invalid_revision",
      message: "revision 必须为正整数。",
      status: 400,
    };
  }

  if (typeof payload.isFinal !== "boolean") {
    return {
      code: "invalid_is_final",
      message: "isFinal 必须为布尔值。",
      status: 400,
    };
  }

  if (!isScenarioId(payload.scenario)) {
    return {
      code: "invalid_scenario",
      message: "scenario 不在当前支持范围内。",
      status: 400,
    };
  }

  if (
    payload.triggerReason !== "stabilized" &&
    payload.triggerReason !== "final" &&
    payload.triggerReason !== "revision"
  ) {
    return {
      code: "invalid_trigger_reason",
      message: "triggerReason 不在当前支持范围内。",
      status: 400,
    };
  }

  return null;
}
