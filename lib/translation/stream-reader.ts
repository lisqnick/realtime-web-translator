import type { TranslationStreamEvent } from "@/types/translation";

interface ParsedSseMessage {
  event: string;
  data: string;
}

export async function readTranslationStream(options: {
  body: ReadableStream<Uint8Array>;
  onEvent: (event: TranslationStreamEvent) => void;
}) {
  const reader = options.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

    const normalizedBuffer = buffer.replace(/\r\n/g, "\n");
    const parts = normalizedBuffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const parsedMessage = parseSseMessage(part);

      if (!parsedMessage?.data) {
        continue;
      }

      const payload = safeParseJson(parsedMessage.data);

      if (!isTranslationStreamEvent(payload)) {
        continue;
      }

      options.onEvent(payload);
    }

    if (done) {
      break;
    }
  }
}

function parseSseMessage(chunk: string): ParsedSseMessage | null {
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

function isTranslationStreamEvent(value: unknown): value is TranslationStreamEvent {
  if (!value || typeof value !== "object") {
    return false;
  }

  const event = value as Partial<TranslationStreamEvent>;

  if (typeof event.type !== "string" || typeof event.segmentId !== "string") {
    return false;
  }

  if (typeof event.revision !== "number") {
    return false;
  }

  switch (event.type) {
    case "translation.started":
      return true;
    case "translation.delta":
      return typeof event.delta === "string" && typeof event.text === "string";
    case "translation.completed":
      return typeof event.text === "string";
    case "translation.error":
      return typeof event.message === "string";
    default:
      return false;
  }
}
