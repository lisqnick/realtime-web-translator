import { serverEnv } from "@/config/env";
import { resolveGlossaryHints } from "@/lib/glossary/hints";
import {
  buildAutomaticTranslationJsonSchema,
  isBidirectionalAutoPairSupported,
  validateAutomaticTranslationResult,
} from "@/lib/translation-core/language-policy";
import type { AutomaticTranslationStructuredOutput } from "@/lib/translation-core/types";
import { buildTranslationPrompt } from "@/lib/translation/prompt-builder";
import type { TranslationStreamRequest } from "@/types/translation";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

interface OpenAIErrorPayload {
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
}

type OpenAITranslationStreamEvent =
  | {
      kind: "delta";
      delta: string;
    }
  | {
      kind: "completed";
      text: string;
    }
  | {
      kind: "error";
      message: string;
    };

interface ParsedSseEvent {
  event: string;
  data: string;
}

interface OpenAIResponsesPayload {
  output?: Array<{
    content?: Array<{
      type?: string;
      text?: string;
      parsed?: unknown;
      refusal?: string;
    }>;
  }>;
  output_text?: string;
  output_parsed?: unknown;
}

const AUTO_TRANSLATION_VALIDATION_ERROR_CODES = new Set([
  "invalid_auto_detected_language",
  "invalid_auto_target_language",
  "invalid_auto_translation_same_as_source",
  "invalid_auto_translation_json",
  "empty_auto_translation",
  "empty_auto_translation_after_normalize",
]);
const AUTO_TRANSLATION_USER_FACING_ERROR_MESSAGE =
  "本段自动互译结果不稳定，请继续说下一句或稍后看最终整理结果。";

export class TranslationStreamError extends Error {
  status: number;
  code: string;
  requestId: string | null;

  constructor(options: {
    message: string;
    code: string;
    status?: number;
    requestId?: string | null;
  }) {
    super(options.message);
    this.name = "TranslationStreamError";
    this.status = options.status ?? 500;
    this.code = options.code;
    this.requestId = options.requestId ?? null;
  }
}

export async function* streamTranslationResponse(
  request: TranslationStreamRequest,
  options?: {
    signal?: AbortSignal;
  },
): AsyncGenerator<OpenAITranslationStreamEvent> {
  if (!serverEnv.openAiApiKey) {
    throw new TranslationStreamError({
      code: "missing_openai_api_key",
      message: "服务端缺少 OPENAI_API_KEY，无法发起翻译请求。",
      status: 500,
    });
  }

  if (!serverEnv.translationModel) {
    throw new TranslationStreamError({
      code: "missing_translation_model",
      message: "服务端缺少有效的 OPENAI_TRANSLATION_MODEL 配置。",
      status: 500,
    });
  }

  if (request.selectedLanguagePair.mode === "bidirectional_auto") {
    yield* streamBidirectionalAutoTranslationResponse(request, options);
    return;
  }

  const glossaryHints = resolveGlossaryHints({
    sourceLanguage: request.sourceLanguage,
    targetLanguage: request.targetLanguage,
    scenario: request.scenario,
    glossaryId: request.glossaryId ?? null,
  });
  const prompt = buildTranslationPrompt({
    directionMode: request.directionMode,
    selectedLanguagePair: request.selectedLanguagePair,
    sourceLanguage: request.sourceLanguage,
    targetLanguage: request.targetLanguage,
    scenario: request.scenario,
    text: request.text,
    previousContext: request.previousContext ?? null,
    glossaryHints,
  });
  const clientRequestId = crypto.randomUUID();

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serverEnv.openAiApiKey}`,
      "Content-Type": "application/json",
      "X-Client-Request-Id": clientRequestId,
    },
    body: JSON.stringify({
      model: serverEnv.translationModel,
      stream: true,
      instructions: prompt.instructions,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: prompt.inputText,
            },
          ],
        },
      ],
      text: {
        format: {
          type: "text",
        },
      },
    }),
    signal:
      options?.signal !== undefined
        ? AbortSignal.any([options.signal, AbortSignal.timeout(20_000)])
        : AbortSignal.timeout(20_000),
  });

  const requestId = response.headers.get("x-request-id");

  if (!response.ok) {
    const errorMessage = await extractOpenAIErrorMessage(response);

    throw new TranslationStreamError({
      code: "openai_translation_stream_failed",
      message: errorMessage,
      status: response.status,
      requestId,
    });
  }

  if (!response.body) {
    throw new TranslationStreamError({
      code: "missing_translation_stream_body",
      message: "OpenAI 返回了空的翻译流。",
      status: 502,
      requestId,
    });
  }

  yield* parseOpenAITranslationStream(response.body);
}

async function* streamBidirectionalAutoTranslationResponse(
  request: TranslationStreamRequest,
  options?: {
    signal?: AbortSignal;
  },
): AsyncGenerator<OpenAITranslationStreamEvent> {
  try {
    const translation = await runBidirectionalAutoTranslationAttempt(request, options);

    yield {
      kind: "completed",
      text: translation,
    };
    return;
  } catch (error) {
    if (
      error instanceof TranslationStreamError &&
      AUTO_TRANSLATION_VALIDATION_ERROR_CODES.has(error.code)
    ) {
      try {
        const retryTranslation = await runBidirectionalAutoTranslationAttempt(request, options);

        yield {
          kind: "completed",
          text: retryTranslation,
        };
        return;
      } catch (retryError) {
        if (
          retryError instanceof TranslationStreamError &&
          AUTO_TRANSLATION_VALIDATION_ERROR_CODES.has(retryError.code)
        ) {
          throw new TranslationStreamError({
            code: retryError.code,
            message: AUTO_TRANSLATION_USER_FACING_ERROR_MESSAGE,
            status: retryError.status,
            requestId: retryError.requestId,
          });
        }

        throw retryError;
      }
    }

    throw error;
  }
}

async function runBidirectionalAutoTranslationAttempt(
  request: TranslationStreamRequest,
  options?: {
    signal?: AbortSignal;
  },
) {
  if (!isBidirectionalAutoPairSupported(request.selectedLanguagePair)) {
    throw new TranslationStreamError({
      code: "unsupported_bidirectional_language_pair",
      message: "当前自动互译语言对尚未支持。",
      status: 400,
    });
  }

  const prompt = buildTranslationPrompt({
    directionMode: request.directionMode,
    selectedLanguagePair: request.selectedLanguagePair,
    sourceLanguage: request.sourceLanguage,
    targetLanguage: request.targetLanguage,
    scenario: request.scenario,
    text: request.text,
    previousContext: request.previousContext ?? null,
    glossaryHints: [],
  });
  const clientRequestId = crypto.randomUUID();

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serverEnv.openAiApiKey}`,
      "Content-Type": "application/json",
      "X-Client-Request-Id": clientRequestId,
    },
    body: JSON.stringify({
      model: serverEnv.translationModel,
      stream: false,
      instructions: prompt.instructions,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: prompt.inputText,
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "bidirectional_translation_result",
          schema: buildAutomaticTranslationJsonSchema(request.selectedLanguagePair),
          strict: true,
        },
      },
    }),
    signal:
      options?.signal !== undefined
        ? AbortSignal.any([options.signal, AbortSignal.timeout(20_000)])
        : AbortSignal.timeout(20_000),
  });

  const requestId = response.headers.get("x-request-id");

  if (!response.ok) {
    const errorMessage = await extractOpenAIErrorMessage(response);

    throw new TranslationStreamError({
      code: "openai_translation_stream_failed",
      message: errorMessage,
      status: response.status,
      requestId,
    });
  }

  const payload = (await response.json()) as OpenAIResponsesPayload;
  const parsedPayload = extractStructuredAutomaticTranslationPayload(payload);
  const validationResult = validateAutomaticTranslationResult({
    selectedLanguagePair: request.selectedLanguagePair,
    sourceText: request.text,
    detectedSourceLanguage: parsedPayload.detected_source_language ?? null,
    translation: parsedPayload.translation,
  });

  if (!validationResult.ok) {
    throw new TranslationStreamError({
      code: validationResult.code,
      message: validationResult.message,
      status: 502,
      requestId,
    });
  }

  return validationResult.translation;
}

async function* parseOpenAITranslationStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<OpenAITranslationStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulatedText = "";
  let completed = false;

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const normalizedBuffer = buffer.replace(/\r\n/g, "\n");
    const parts = normalizedBuffer.split("\n\n");

    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const parsedEvent = parseSseEvent(part);

      if (!parsedEvent) {
        continue;
      }

      if (parsedEvent.data === "[DONE]") {
        continue;
      }

      if (parsedEvent.event === "response.output_text.delta") {
        const payload = safeParseJson(parsedEvent.data) as { delta?: unknown } | null;
        const delta = typeof payload?.delta === "string" ? payload.delta : "";

        if (delta) {
          accumulatedText += delta;
          yield {
            kind: "delta",
            delta,
          };
        }

        continue;
      }

      if (parsedEvent.event === "response.output_text.done") {
        const payload = safeParseJson(parsedEvent.data) as { text?: unknown } | null;
        const text = typeof payload?.text === "string" ? payload.text : accumulatedText;

        completed = true;
        yield {
          kind: "completed",
          text,
        };
        continue;
      }

      if (parsedEvent.event === "response.completed") {
        if (!completed) {
          const payload = safeParseJson(parsedEvent.data) as
            | {
                response?: {
                  output?: Array<{
                    content?: Array<{
                      type?: string;
                      text?: string;
                    }>;
                  }>;
                };
              }
            | null;
          const finalText =
            payload?.response?.output
              ?.flatMap((item) => item.content ?? [])
              .find((content) => content.type === "output_text")?.text ?? accumulatedText;

          completed = true;
          yield {
            kind: "completed",
            text: finalText,
          };
        }

        continue;
      }

      if (parsedEvent.event === "error") {
        const payload = safeParseJson(parsedEvent.data) as
          | {
              error?: {
                message?: string;
              };
            }
          | null;

        yield {
          kind: "error",
          message: payload?.error?.message ?? "OpenAI 翻译流返回了错误事件。",
        };
      }
    }

    if (done) {
      break;
    }
  }

  if (!completed && accumulatedText) {
    yield {
      kind: "completed",
      text: accumulatedText,
    };
  }
}

function extractStructuredAutomaticTranslationPayload(
  payload: OpenAIResponsesPayload,
): AutomaticTranslationStructuredOutput {
  if (isStructuredAutomaticTranslationPayload(payload.output_parsed)) {
    return payload.output_parsed;
  }

  const contentItems =
    payload.output?.flatMap((item) => item.content ?? []) ?? [];

  for (const contentItem of contentItems) {
    if (isStructuredAutomaticTranslationPayload(contentItem.parsed)) {
      return contentItem.parsed;
    }

    if (typeof contentItem.refusal === "string" && contentItem.refusal.trim()) {
      throw new TranslationStreamError({
        code: "invalid_auto_translation_json",
        message: "自动互译被模型拒绝。",
        status: 502,
      });
    }

    if (typeof contentItem.text === "string" && contentItem.text.trim()) {
      const parsedText = safeParseJson(contentItem.text);

      if (isStructuredAutomaticTranslationPayload(parsedText)) {
        return parsedText;
      }
    }
  }

  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    const parsedOutputText = safeParseJson(payload.output_text);

    if (isStructuredAutomaticTranslationPayload(parsedOutputText)) {
      return parsedOutputText;
    }
  }

  throw new TranslationStreamError({
    code: "invalid_auto_translation_json",
    message: "自动互译返回的结构化结果无法解析。",
    status: 502,
  });
}

function isStructuredAutomaticTranslationPayload(
  value: unknown,
): value is AutomaticTranslationStructuredOutput {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.detected_source_language === "string" &&
    typeof candidate.translation === "string"
  );
}

function parseSseEvent(chunk: string): ParsedSseEvent | null {
  const lines = chunk
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);

  if (lines.length === 0) {
    return null;
  }

  let event = "message";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
      continue;
    }

    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trim());
    }
  }

  return {
    event,
    data: dataLines.join("\n"),
  };
}

function safeParseJson(payload: string) {
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    return null;
  }
}

async function extractOpenAIErrorMessage(response: Response) {
  try {
    const payload = (await response.json()) as OpenAIErrorPayload;
    if (payload.error?.message) {
      return payload.error.message;
    }
  } catch {
    // Ignore JSON parsing errors and fall back to text.
  }

  const text = await response.text().catch(() => "");
  return text || "OpenAI 翻译请求失败。";
}
