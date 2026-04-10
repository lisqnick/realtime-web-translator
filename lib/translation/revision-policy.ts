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
  finalizedSegments: TranscriptSegment[];
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
        options.finalizedSegments,
        options.finalSegment.segmentId,
        config.recentWindowSize,
      ),
    };
  }

  const similarity = computeTextSimilarity(
    options.translationSegment.translatedSourceText,
    options.finalSegment.text,
  );
  const withinRecentWindow = isWithinRecentWindow(
    options.finalizedSegments,
    options.finalSegment.segmentId,
    config.recentWindowSize,
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
  finalizedSegments: TranscriptSegment[],
  segmentId: string,
  recentWindowSize: number,
) {
  const recentSegmentIds = finalizedSegments
    .slice(Math.max(0, finalizedSegments.length - recentWindowSize))
    .map((segment) => segment.segmentId);

  return recentSegmentIds.includes(segmentId);
}
