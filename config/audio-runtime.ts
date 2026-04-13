import type {
  RealtimeNoiseReductionType,
  RealtimeTurnDetectionConfig,
} from "@/types/realtime";

export const AUDIO_RUNTIME_CONFIG = {
  serverVad: {
    threshold: 0.5,
    prefixPaddingMs: 300,
    silenceDurationMs: 240,
  },
  noiseReduction: "near_field" as RealtimeNoiseReductionType,
} as const;

export function getAudioRuntimeTurnDetectionConfig(): RealtimeTurnDetectionConfig {
  return {
    type: "server_vad",
    threshold: AUDIO_RUNTIME_CONFIG.serverVad.threshold,
    prefixPaddingMs: AUDIO_RUNTIME_CONFIG.serverVad.prefixPaddingMs,
    silenceDurationMs: AUDIO_RUNTIME_CONFIG.serverVad.silenceDurationMs,
  };
}
