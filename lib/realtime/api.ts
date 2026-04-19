import type {
  SupportedLanguageCode,
  TranslationDirectionMode,
} from "@/types/config";
import type {
  ApiErrorResponse,
  AudioRuntimeMode,
  RealtimeSessionResponse,
} from "@/types/realtime";

export async function requestRealtimeSession(options: {
  directionMode?: TranslationDirectionMode;
  sourceLanguage?: SupportedLanguageCode;
  targetLanguage?: SupportedLanguageCode;
  audioRuntimeMode?: AudioRuntimeMode;
  signal?: AbortSignal;
}) {
  const response = await fetch("/api/realtime/session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    cache: "no-store",
    body: JSON.stringify({
      directionMode: options.directionMode,
      sourceLanguage: options.sourceLanguage,
      targetLanguage: options.targetLanguage,
      audioRuntimeMode: options.audioRuntimeMode,
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    const errorPayload = (await response.json().catch(() => null)) as ApiErrorResponse | null;
    const errorMessage =
      errorPayload?.error.message ?? "获取 Realtime 会话失败，请稍后再试。";
    throw new Error(errorMessage);
  }

  return (await response.json()) as RealtimeSessionResponse;
}
