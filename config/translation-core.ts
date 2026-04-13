import type { BubbleAggregationConfig } from "@/types/bubble";

export const TRANSLATION_CORE_CONFIG = {
  bubbleAggregation: {
    appendWithinMs: 1200,
    splitAfterMs: 1500,
    sealAfterMs: 3000,
    finalTranslateAfterMs: 6000,
    maxChunksPerBubble: 5,
    correctionTailSize: 2,
  } satisfies BubbleAggregationConfig,
  scheduler: {
    maxConcurrentJobs: 2,
  },
  backgroundAutoStopMs: 10_000,
} as const;

export function getBubbleAggregationConfig(): BubbleAggregationConfig {
  return TRANSLATION_CORE_CONFIG.bubbleAggregation;
}
