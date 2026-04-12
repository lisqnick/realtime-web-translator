import type { BubbleCloseReason, TranslationBubble } from "@/types/bubble";

export type BubbleFinalTranslationDecision =
  | { shouldRun: true; reason: "boundary_close"; schedule: "immediate" }
  | { shouldRun: true; reason: "idle_timeout"; schedule: "deferred" }
  | { shouldRun: false; reason: "single_chunk" | "unsupported_close_reason" };

const IMMEDIATE_BUBBLE_FINAL_TRANSLATION_CLOSE_REASONS: BubbleCloseReason[] = [
  "gap_too_large",
  "max_chunks_reached",
  "scenario_changed",
  "language_changed",
  "force_closed",
];

export function isImmediateBubbleFinalTranslationCloseReason(
  reason: BubbleCloseReason | null,
): reason is BubbleCloseReason {
  return (
    reason !== null &&
    IMMEDIATE_BUBBLE_FINAL_TRANSLATION_CLOSE_REASONS.includes(reason)
  );
}

export function evaluateBubbleFinalTranslationPolicy(
  bubble: TranslationBubble,
): BubbleFinalTranslationDecision {
  if (bubble.chunkCount < 2) {
    return { shouldRun: false, reason: "single_chunk" };
  }

  if (bubble.closeReason === "idle_timeout") {
    return { shouldRun: true, reason: "idle_timeout", schedule: "deferred" };
  }

  if (isImmediateBubbleFinalTranslationCloseReason(bubble.closeReason)) {
    return { shouldRun: true, reason: "boundary_close", schedule: "immediate" };
  }

  return { shouldRun: false, reason: "unsupported_close_reason" };
}
