import type { ApiErrorResponse } from "@/types/realtime";
import type { TranslationStreamRequest, TranslationStreamEvent } from "@/types/translation";

import { readTranslationStream } from "./stream-reader";

const TRANSLATION_STREAM_ENDPOINT = "/api/translate/stream";

export class TranslationClientError extends Error {
  status: number;
  code: string;

  constructor(options: { message: string; code: string; status?: number }) {
    super(options.message);
    this.name = "TranslationClientError";
    this.status = options.status ?? 500;
    this.code = options.code;
  }
}

export async function streamSegmentTranslation(options: {
  request: TranslationStreamRequest;
  signal?: AbortSignal;
  onEvent: (event: TranslationStreamEvent) => void;
}) {
  const response = await fetch(TRANSLATION_STREAM_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(options.request),
    signal: options.signal,
  });

  if (!response.ok) {
    throw await buildTranslationClientError(response);
  }

  if (!response.body) {
    throw new TranslationClientError({
      code: "missing_translation_stream_body",
      message: "翻译接口未返回可读取的流式响应。",
      status: 502,
    });
  }

  await readTranslationStream({
    body: response.body,
    onEvent: options.onEvent,
  });
}

async function buildTranslationClientError(response: Response) {
  try {
    const payload = (await response.json()) as ApiErrorResponse;

    if (!payload.ok) {
      return new TranslationClientError({
        code: payload.error.code,
        message: payload.error.message,
        status: payload.error.status ?? response.status,
      });
    }
  } catch {
    // Ignore JSON parsing failures and fall back to text.
  }

  const text = await response.text().catch(() => "");

  return new TranslationClientError({
    code: "translation_stream_request_failed",
    message: text || "翻译请求失败。",
    status: response.status,
  });
}
