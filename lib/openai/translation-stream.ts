import { serverEnv } from "@/config/env";
import { resolveGlossaryHints } from "@/lib/glossary/hints";
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

  const glossaryHints = resolveGlossaryHints({
    sourceLanguage: request.sourceLanguage,
    targetLanguage: request.targetLanguage,
    scenario: request.scenario,
    glossaryId: request.glossaryId ?? null,
  });
  const prompt = buildTranslationPrompt({
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
    // Ignore JSON parsing failures and fall back to text.
  }

  try {
    const text = await response.text();

    if (text) {
      return text;
    }
  } catch {
    // Ignore text parsing failures.
  }

  return "OpenAI 翻译请求失败。";
}
