import type {
  AudioRuntimeMode,
  RealtimeNoiseReductionType,
  RealtimeTurnDetectionConfig,
} from "@/types/realtime";

export const AUDIO_RUNTIME_CONFIGS = {
  normal: {
    serverVad: {
      threshold: 0.5,
      prefixPaddingMs: 300,
      silenceDurationMs: 240,
    },
    noiseReduction: "near_field" as RealtimeNoiseReductionType,
  },
  noisy: {
    serverVad: {
      threshold: 0.62,
      prefixPaddingMs: 300,
      silenceDurationMs: 300,
    },
    noiseReduction: "far_field" as RealtimeNoiseReductionType,
  },
} as const;

export function getAudioRuntimeConfig(mode: AudioRuntimeMode = "normal") {
  return AUDIO_RUNTIME_CONFIGS[mode];
}

export function getAudioRuntimeTurnDetectionConfig(
  mode: AudioRuntimeMode = "normal",
): RealtimeTurnDetectionConfig {
  const config = getAudioRuntimeConfig(mode);

  return {
    type: "server_vad",
    threshold: config.serverVad.threshold,
    prefixPaddingMs: config.serverVad.prefixPaddingMs,
    silenceDurationMs: config.serverVad.silenceDurationMs,
  };
}
