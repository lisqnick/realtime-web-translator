import type { TranscriptSegment } from "@/types/realtime";
import type { TranslatedSegment } from "@/types/translation";

import { computeTextSimilarity } from "./text-similarity";

export interface RevisionPolicyConfig {
  recentWindowSize: number;
  keepSimilarityThreshold: number;
  retranslateSimilarityThreshold: number;
}

export interface FinalRevisionDecision {
  action: "keep" | "retranslate";
  similarity: number;
  withinRecentWindow: boolean;
}

const DEFAULT_REVISION_POLICY_CONFIG: RevisionPolicyConfig = {
  recentWindowSize: 2,
  keepSimilarityThreshold: 0.92,
  retranslateSimilarityThreshold: 0.78,
};

export function getDefaultRevisionPolicyConfig(): RevisionPolicyConfig {
  return DEFAULT_REVISION_POLICY_CONFIG;
}

export function evaluateFinalRevision(options: {
  finalSegment: TranscriptSegment;
  bubbleTailSegmentIds: string[];
  translationSegment: TranslatedSegment | null;
  config?: Partial<RevisionPolicyConfig>;
}): FinalRevisionDecision {
  const config = {
    ...DEFAULT_REVISION_POLICY_CONFIG,
    ...options.config,
  };

  if (!options.translationSegment?.translatedSourceText) {
    return {
      action: "retranslate",
      similarity: 0,
      withinRecentWindow: isWithinRecentWindow(
        options.bubbleTailSegmentIds,
        options.finalSegment.segmentId,
      ),
    };
  }

  const similarity = computeTextSimilarity(
    options.translationSegment.translatedSourceText,
    options.finalSegment.text,
  );
  const withinRecentWindow = isWithinRecentWindow(
    options.bubbleTailSegmentIds,
    options.finalSegment.segmentId,
  );

  if (similarity >= config.keepSimilarityThreshold) {
    return {
      action: "keep",
      similarity,
      withinRecentWindow,
    };
  }

  if (withinRecentWindow && similarity <= config.retranslateSimilarityThreshold) {
    return {
      action: "retranslate",
      similarity,
      withinRecentWindow,
    };
  }

  return {
    action: "keep",
    similarity,
    withinRecentWindow,
  };
}

function isWithinRecentWindow(
  bubbleTailSegmentIds: string[],
  segmentId: string,
) {
  return bubbleTailSegmentIds.includes(segmentId);
}
