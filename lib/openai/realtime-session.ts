import { serverEnv } from "@/config/env";
import type { SupportedLanguageCode } from "@/types/config";
import type {
  RealtimeSessionResponse,
  RealtimeTranscriptionLanguage,
  RealtimeTurnDetectionConfig,
} from "@/types/realtime";

const OPENAI_REALTIME_CLIENT_SECRETS_URL =
  "https://api.openai.com/v1/realtime/client_secrets";
const DEFAULT_REALTIME_TURN_DETECTION: RealtimeTurnDetectionConfig = {
  type: "server_vad",
  threshold: 0.5,
  prefixPaddingMs: 300,
  silenceDurationMs: 240,
};

interface CreateRealtimeSessionInput {
  sourceLanguage: SupportedLanguageCode;
}

interface OpenAIRealtimeSessionPayload {
  session?: {
    id?: string;
    type?: string;
    expires_at?: number;
    audio?: {
      input?: {
        transcription?: {
          model?: string;
          language?: string;
        };
        turn_detection?: {
          type?: string;
          threshold?: number;
          prefix_padding_ms?: number;
          silence_duration_ms?: number;
        };
      };
    };
    include?: string[];
  };
  id?: string;
  type?: string;
  expires_at?: number;
  audio?: {
    input?: {
      transcription?: {
        model?: string;
        language?: string;
      };
      turn_detection?: {
        type?: string;
        threshold?: number;
        prefix_padding_ms?: number;
        silence_duration_ms?: number;
      };
    };
  };
  include?: string[];
  value?: string;
  expires_at_ms?: number;
  client_secret?: {
    value?: string;
    expires_at?: number;
  };
}

interface OpenAIErrorPayload {
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
}

export class RealtimeSessionCreationError extends Error {
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
    this.name = "RealtimeSessionCreationError";
    this.status = options.status ?? 500;
    this.code = options.code;
    this.requestId = options.requestId ?? null;
  }
}

export function mapSupportedLanguageToRealtimeLanguage(
  sourceLanguage: SupportedLanguageCode,
): RealtimeTranscriptionLanguage {
  switch (sourceLanguage) {
    case "zh-CN":
      return "zh";
    case "ja-JP":
      return "ja";
    case "en-US":
      return "en";
    case "ko-KR":
      return "ko";
  }
}

export function buildRealtimeTurnDetectionConfig(): RealtimeTurnDetectionConfig {
  return DEFAULT_REALTIME_TURN_DETECTION;
}

export function buildRealtimeSessionConfig({ sourceLanguage }: CreateRealtimeSessionInput) {
  const language = mapSupportedLanguageToRealtimeLanguage(sourceLanguage);
  const turnDetection = buildRealtimeTurnDetectionConfig();

  return {
    type: "transcription" as const,
    audio: {
      input: {
        noise_reduction: {
          type: "near_field" as const,
        },
        transcription: {
          model: serverEnv.realtimeTranscriptionModel,
          language,
          prompt: "",
        },
        turn_detection: {
          type: turnDetection.type,
          threshold: turnDetection.threshold,
          prefix_padding_ms: turnDetection.prefixPaddingMs,
          silence_duration_ms: turnDetection.silenceDurationMs,
        },
      },
    },
    include: [] as string[],
  };
}

export async function createRealtimeSession({
  sourceLanguage,
}: CreateRealtimeSessionInput): Promise<RealtimeSessionResponse> {
  if (!serverEnv.openAiApiKey) {
    throw new RealtimeSessionCreationError({
      code: "missing_openai_api_key",
      message: "服务端缺少 OPENAI_API_KEY，无法创建 Realtime 会话。",
      status: 500,
    });
  }

  const sessionConfig = buildRealtimeSessionConfig({ sourceLanguage });
  const clientRequestId = crypto.randomUUID();

  const response = await fetch(OPENAI_REALTIME_CLIENT_SECRETS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serverEnv.openAiApiKey}`,
      "Content-Type": "application/json",
      "X-Client-Request-Id": clientRequestId,
    },
    body: JSON.stringify({
      session: sessionConfig,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  const requestId = response.headers.get("x-request-id");

  if (!response.ok) {
    const errorMessage = await extractOpenAIErrorMessage(response);

    throw new RealtimeSessionCreationError({
      code: "openai_realtime_session_failed",
      message: errorMessage,
      status: response.status,
      requestId,
    });
  }

  const payload = (await response.json()) as OpenAIRealtimeSessionPayload;
  const normalizedSession = payload.session ?? payload;
  const clientSecretValue = payload.client_secret?.value ?? payload.value;
  const clientSecretExpiresAt = payload.client_secret?.expires_at ?? payload.expires_at ?? null;

  if (!clientSecretValue || !normalizedSession.id) {
    throw new RealtimeSessionCreationError({
      code: "invalid_realtime_session_response",
      message: "OpenAI 返回了不完整的 Realtime 会话信息。",
      status: 502,
      requestId,
    });
  }

  const turnDetection = normalizedSession.audio?.input?.turn_detection;
  const transcription = normalizedSession.audio?.input?.transcription;

  return {
    ok: true,
    clientSecret: {
      value: clientSecretValue,
      expiresAt: clientSecretExpiresAt,
    },
    session: {
      id: normalizedSession.id,
      type: "transcription",
      expiresAt: normalizedSession.expires_at ?? null,
      model: transcription?.model ?? serverEnv.realtimeTranscriptionModel,
      language:
        (transcription?.language as RealtimeTranscriptionLanguage | undefined) ??
        mapSupportedLanguageToRealtimeLanguage(sourceLanguage),
      turnDetection: {
        type: "server_vad",
        threshold: turnDetection?.threshold ?? DEFAULT_REALTIME_TURN_DETECTION.threshold,
        prefixPaddingMs:
          turnDetection?.prefix_padding_ms ?? DEFAULT_REALTIME_TURN_DETECTION.prefixPaddingMs,
        silenceDurationMs:
          turnDetection?.silence_duration_ms ??
          DEFAULT_REALTIME_TURN_DETECTION.silenceDurationMs,
      },
      include: normalizedSession.include ?? [],
    },
  };
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

  try {
    const text = await response.text();
    if (text) {
      return text;
    }
  } catch {
    // Ignore text parsing errors.
  }

  return "创建 OpenAI Realtime 会话失败。";
}
