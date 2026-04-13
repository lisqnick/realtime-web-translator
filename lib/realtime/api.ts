import type { SupportedLanguageCode } from "@/types/config";
import type { ApiErrorResponse, RealtimeSessionResponse } from "@/types/realtime";

export async function requestRealtimeSession(options: {
  sourceLanguage?: SupportedLanguageCode;
  signal?: AbortSignal;
}) {
  const response = await fetch("/api/realtime/session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    cache: "no-store",
    body: JSON.stringify({
      sourceLanguage: options.sourceLanguage,
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
