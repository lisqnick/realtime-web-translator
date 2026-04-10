import type { TranscriptPerfSnapshot } from "@/types/realtime";

type PerfMarkKey =
  | "micStartAt"
  | "realtimeConnectedAt"
  | "firstPartialTranscriptAt"
  | "firstFinalTranscriptAt"
  | "firstStableTriggerAt"
  | "firstTranslationRequestAt"
  | "firstTranslationDeltaAt"
  | "firstTranslationCompleteAt";

export function createEmptyTranscriptPerfSnapshot(): TranscriptPerfSnapshot {
  return {
    micStartAt: null,
    realtimeConnectedAt: null,
    firstPartialTranscriptAt: null,
    firstFinalTranscriptAt: null,
    firstStableTriggerAt: null,
    firstTranslationRequestAt: null,
    firstTranslationDeltaAt: null,
    firstTranslationCompleteAt: null,
  };
}

export function markTranscriptPerf(
  snapshot: TranscriptPerfSnapshot,
  key: PerfMarkKey,
  options?: {
    debug?: boolean;
  },
) {
  if (snapshot[key] !== null) {
    return snapshot;
  }

  const timestamp = Date.now();
  const nextSnapshot: TranscriptPerfSnapshot = {
    ...snapshot,
    [key]: timestamp,
  };

  if (options?.debug) {
    const elapsedFromMic =
      nextSnapshot.micStartAt === null ? null : timestamp - nextSnapshot.micStartAt;
    const elapsedLabel =
      elapsedFromMic === null ? "n/a" : `${elapsedFromMic.toString()}ms from mic start`;

    console.info(`[perf] ${key} at ${new Date(timestamp).toISOString()} (${elapsedLabel})`);
  }

  return nextSnapshot;
}

export function getRelativePerfDurations(snapshot: TranscriptPerfSnapshot) {
  const fromMicStart = (timestamp: number | null) =>
    snapshot.micStartAt === null || timestamp === null ? null : timestamp - snapshot.micStartAt;

  return {
    timeToRealtimeConnectedMs: fromMicStart(snapshot.realtimeConnectedAt),
    timeToFirstPartialTranscriptMs: fromMicStart(snapshot.firstPartialTranscriptAt),
    timeToFirstFinalTranscriptMs: fromMicStart(snapshot.firstFinalTranscriptAt),
    timeToFirstStableTriggerMs: fromMicStart(snapshot.firstStableTriggerAt),
    timeToFirstTranslationRequestMs: fromMicStart(snapshot.firstTranslationRequestAt),
    timeToFirstTranslationDeltaMs: fromMicStart(snapshot.firstTranslationDeltaAt),
    timeToFirstTranslationCompleteMs: fromMicStart(snapshot.firstTranslationCompleteAt),
  };
}
