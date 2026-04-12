import type { TranslationBubble } from "@/types/bubble";

export type BubbleFinalTranslationDecision =
  | { shouldRun: true; reason: "multi_chunk" }
  | { shouldRun: false; reason: "single_chunk" };

export function evaluateBubbleFinalTranslationPolicy(
  bubble: TranslationBubble,
): BubbleFinalTranslationDecision {
  if (bubble.chunkCount >= 2) {
    return { shouldRun: true, reason: "multi_chunk" };
  }

  return { shouldRun: false, reason: "single_chunk" };
}
