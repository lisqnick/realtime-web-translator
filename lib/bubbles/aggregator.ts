import type { ScenarioId, SupportedLanguageCode } from "@/types/config";
import type {
  BubbleAggregationConfig,
  BubbleFinalTranslation,
  BubbleSnapshot,
  TranslationBubble,
} from "@/types/bubble";
import type { TranscriptStateSnapshot } from "@/types/realtime";
import type { TranslatedSegment } from "@/types/translation";

import { getBubbleAggregationConfig } from "@/config/translation-core";
import { buildBubbleLifecycle } from "@/lib/bubbles/lifecycle";
import { applyBubbleSealing } from "@/lib/bubbles/sealing";
import { projectBubbleTranslation } from "@/lib/translation-core/translation-projection";

export function getDefaultBubbleAggregationConfig(): BubbleAggregationConfig {
  return getBubbleAggregationConfig();
}

export function createEmptyBubbleSnapshot(): BubbleSnapshot {
  return {
    bubbles: [],
    activeBubbleId: null,
    debug: {
      activeBubbleId: null,
      activeBubbleChunkCount: 0,
      lastChunkGapMs: null,
      lastChunkGapBasis: null,
      lastOpenReason: null,
      activeBubbleIsTranslating: false,
      activeBubbleCorrectionCount: 0,
      recentDecisions: [],
    },
  };
}

export function buildBubbleSnapshot(input: {
  transcriptSnapshot: TranscriptStateSnapshot;
  translatedSegments: TranslatedSegment[];
  bubbleFinalTranslations?: BubbleFinalTranslation[];
  scenario: ScenarioId;
  sourceLanguage: SupportedLanguageCode;
  targetLanguage: SupportedLanguageCode;
  config?: Partial<BubbleAggregationConfig>;
  forceCloseActiveBubble?: boolean;
  nowMs?: number;
}): BubbleSnapshot {
  const config = {
    ...getBubbleAggregationConfig(),
    ...input.config,
  };
  const nowMs = input.nowMs ?? Date.now();

  if (
    input.transcriptSnapshot.segments.every((segment) => !segment.text.trim())
  ) {
    return createEmptyBubbleSnapshot();
  }

  const { bubbles, debug } = buildBubbleLifecycle({
    transcriptSnapshot: input.transcriptSnapshot,
    translatedSegments: input.translatedSegments,
    bubbleFinalTranslations: input.bubbleFinalTranslations,
    scenario: input.scenario,
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage,
    config,
  });
  applyBubbleSealing({
    bubbles,
    forceCloseActiveBubble: input.forceCloseActiveBubble ?? false,
    nowMs,
    config,
  });
  for (const bubble of bubbles) {
    const projection = projectBubbleTranslation(bubble);
    bubble.mergedTranslationText = projection.mergedTranslationText;
    bubble.displayStatus = projection.displayStatus;
    bubble.errorMessage = projection.displayError;
  }

  const activeBubble = bubbles.at(-1) ?? null;
  debug.activeBubbleId = activeBubble?.bubbleId ?? null;
  debug.activeBubbleChunkCount = activeBubble?.chunkCount ?? 0;
  debug.lastOpenReason = activeBubble?.openedBy ?? null;
  debug.activeBubbleIsTranslating = activeBubble?.isTranslating ?? false;
  debug.activeBubbleCorrectionCount = activeBubble?.correctionCount ?? 0;

  return {
    bubbles,
    activeBubbleId: activeBubble?.bubbleId ?? null,
    debug,
  };
}

export function getBubbleTailSegmentIds(
  bubbles: TranslationBubble[],
  segmentId: string,
  tailSize = getBubbleAggregationConfig().correctionTailSize,
) {
  const bubble = bubbles.find((candidate) =>
    candidate.sourceChunks.some((chunk) => chunk.segmentId === segmentId),
  );

  if (!bubble) {
    return [];
  }

  return bubble.sourceChunks
    .slice(Math.max(0, bubble.sourceChunks.length - tailSize))
    .map((chunk) => chunk.segmentId);
}
