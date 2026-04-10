import type { TranscriptSegment, TranscriptStateSnapshot } from "@/types/realtime";
import type { TranslationTriggerReason } from "@/types/translation";

import { computeTextSimilarity } from "@/lib/translation/text-similarity";

export interface StabilizerConfig {
  stableAfterMs: number;
  minCharsToTrigger: number;
  punctuationTrigger: RegExp;
  similarityThreshold: number;
  forceTriggerOnFinal: boolean;
  pollIntervalMs: number;
}

export interface StabilizerSuggestion {
  segmentId: string;
  revision: number;
  sourceText: string;
  reason: TranslationTriggerReason;
  isFinal: boolean;
}

interface SegmentObservation {
  lastObservedText: string;
  previousObservedText: string;
  lastObservedRevision: number;
  lastTriggeredRevision: number;
  lastTriggeredText: string;
}

export interface TranscriptStabilizer {
  config: StabilizerConfig;
  evaluate: (
    snapshot: TranscriptStateSnapshot,
    timestamp?: number,
  ) => StabilizerSuggestion[];
  markTriggered: (suggestion: StabilizerSuggestion) => void;
  reset: () => void;
}

const DEFAULT_STABILIZER_CONFIG: StabilizerConfig = {
  stableAfterMs: 550,
  minCharsToTrigger: 6,
  punctuationTrigger: /[。！？!?.,，、]$/,
  similarityThreshold: 0.9,
  forceTriggerOnFinal: true,
  pollIntervalMs: 180,
};

export function createTranscriptStabilizer(
  config?: Partial<StabilizerConfig>,
): TranscriptStabilizer {
  const resolvedConfig: StabilizerConfig = {
    ...DEFAULT_STABILIZER_CONFIG,
    ...config,
  };
  const observations = new Map<string, SegmentObservation>();

  return {
    config: resolvedConfig,
    evaluate(snapshot, timestamp = Date.now()) {
      const suggestions: StabilizerSuggestion[] = [];

      for (const segment of snapshot.segments) {
        const observation = getOrCreateObservation(observations, segment.segmentId);

        if (
          observation.lastObservedRevision !== segment.revision ||
          observation.lastObservedText !== segment.text
        ) {
          observation.previousObservedText = observation.lastObservedText;
          observation.lastObservedText = segment.text;
          observation.lastObservedRevision = segment.revision;
        }

        if (segment.status === "final") {
          if (
            resolvedConfig.forceTriggerOnFinal &&
            shouldEmitSuggestion(observation, segment.revision, segment.text)
          ) {
            suggestions.push({
              segmentId: segment.segmentId,
              revision: segment.revision,
              sourceText: segment.text,
              reason: "final",
              isFinal: true,
            });
          }

          continue;
        }

        if (!segment.text.trim() || segment.text.trim().length < resolvedConfig.minCharsToTrigger) {
          continue;
        }

        if (!shouldEmitSuggestion(observation, segment.revision, segment.text)) {
          continue;
        }

        if (!shouldTriggerStableSuggestion(resolvedConfig, segment, observation, timestamp)) {
          continue;
        }

        suggestions.push({
          segmentId: segment.segmentId,
          revision: segment.revision,
          sourceText: segment.text,
          reason: "stabilized",
          isFinal: false,
        });
      }

      return suggestions;
    },
    markTriggered(suggestion) {
      const observation = getOrCreateObservation(observations, suggestion.segmentId);
      observation.lastTriggeredRevision = suggestion.revision;
      observation.lastTriggeredText = suggestion.sourceText;
    },
    reset() {
      observations.clear();
    },
  };
}

function getOrCreateObservation(
  observations: Map<string, SegmentObservation>,
  segmentId: string,
) {
  const existingObservation = observations.get(segmentId);

  if (existingObservation) {
    return existingObservation;
  }

  const nextObservation: SegmentObservation = {
    lastObservedText: "",
    previousObservedText: "",
    lastObservedRevision: 0,
    lastTriggeredRevision: 0,
    lastTriggeredText: "",
  };

  observations.set(segmentId, nextObservation);
  return nextObservation;
}

function shouldEmitSuggestion(
  observation: SegmentObservation,
  revision: number,
  sourceText: string,
) {
  return !(
    observation.lastTriggeredRevision === revision && observation.lastTriggeredText === sourceText
  );
}

function shouldTriggerStableSuggestion(
  config: StabilizerConfig,
  segment: TranscriptSegment,
  observation: SegmentObservation,
  timestamp: number,
) {
  const stableForMs = timestamp - segment.updatedAt;
  const endsWithPunctuation = config.punctuationTrigger.test(segment.text.trim());
  const similarityToPrevious = observation.previousObservedText
    ? computeTextSimilarity(observation.previousObservedText, segment.text)
    : 0;
  const committedSignal =
    segment.committedAt !== null && segment.committedAt >= segment.updatedAt;

  if (endsWithPunctuation) {
    return true;
  }

  if (committedSignal && stableForMs >= Math.max(120, config.stableAfterMs / 2)) {
    return true;
  }

  if (stableForMs < config.stableAfterMs) {
    return false;
  }

  if (similarityToPrevious >= config.similarityThreshold) {
    return true;
  }

  return segment.text.trim().length >= config.minCharsToTrigger * 2;
}
