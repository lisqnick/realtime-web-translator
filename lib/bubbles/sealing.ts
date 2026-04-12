import type {
  BubbleAggregationConfig,
  BubbleCloseReason,
  BubbleStatus,
  TranslationBubble,
} from "@/types/bubble";

export function applyBubbleSealing(input: {
  bubbles: TranslationBubble[];
  forceCloseActiveBubble: boolean;
  nowMs: number;
  config: BubbleAggregationConfig;
}) {
  for (const [index, bubble] of input.bubbles.entries()) {
    const isLastBubble = index === input.bubbles.length - 1;
    const nextBubble = isLastBubble ? null : input.bubbles[index + 1] ?? null;
    const sealedAt = getBubbleSealedAt({
      bubble,
      isLastBubble,
      forceCloseActiveBubble: input.forceCloseActiveBubble,
      nowMs: input.nowMs,
      sealAfterMs: input.config.sealAfterMs,
      nextBubbleCreatedAt: nextBubble?.createdAt ?? null,
    });

    bubble.status = deriveBubbleStatus({
      bubble,
      sealedAt,
    });
    bubble.closedAt = sealedAt;
    bubble.closeReason = getBubbleCloseReason({
      bubble,
      sealedAt,
      isLastBubble,
      forceCloseActiveBubble: input.forceCloseActiveBubble,
      nextBubbleOpenedBy: nextBubble?.openedBy ?? null,
      nowMs: input.nowMs,
      sealAfterMs: input.config.sealAfterMs,
    });
  }

  return input.bubbles;
}

export function getBubbleSealDeadline(
  bubble: TranslationBubble,
  sealAfterMs: number,
) {
  if (hasBubbleLiveSource(bubble)) {
    return null;
  }

  const lastSourceActivityAt = getBubbleLastSourceActivityAt(bubble);

  if (lastSourceActivityAt === null) {
    return null;
  }

  return lastSourceActivityAt + sealAfterMs;
}

export function getBubbleLastSourceActivityAt(bubble: TranslationBubble) {
  const lastChunk = bubble.sourceChunks.at(-1);

  if (!lastChunk) {
    return null;
  }

  return (
    lastChunk.speechStoppedAt ??
    lastChunk.committedAt ??
    lastChunk.finalizedAt ??
    lastChunk.createdAt
  );
}

function deriveBubbleStatus(input: {
  bubble: TranslationBubble;
  sealedAt: number | null;
}): BubbleStatus {
  if (input.sealedAt !== null) {
    return "closed";
  }

  return hasBubbleLiveSource(input.bubble) || input.bubble.isTranslating
    ? "live"
    : "stable";
}

function getBubbleSealedAt(input: {
  bubble: TranslationBubble;
  isLastBubble: boolean;
  forceCloseActiveBubble: boolean;
  nowMs: number;
  sealAfterMs: number;
  nextBubbleCreatedAt: number | null;
}) {
  if (!input.isLastBubble) {
    return input.nextBubbleCreatedAt ?? input.bubble.updatedAt;
  }

  if (input.forceCloseActiveBubble) {
    return input.nowMs;
  }

  const sealDeadline = getBubbleSealDeadline(input.bubble, input.sealAfterMs);

  if (sealDeadline === null) {
    return null;
  }

  return input.nowMs >= sealDeadline ? sealDeadline : null;
}

function getBubbleCloseReason(input: {
  bubble: TranslationBubble;
  sealedAt: number | null;
  isLastBubble: boolean;
  forceCloseActiveBubble: boolean;
  nextBubbleOpenedBy: TranslationBubble["openedBy"] | null;
  nowMs: number;
  sealAfterMs: number;
}): BubbleCloseReason | null {
  if (input.sealedAt === null) {
    return null;
  }

  if (!input.isLastBubble) {
    return input.nextBubbleOpenedBy ?? "force_closed";
  }

  if (input.forceCloseActiveBubble) {
    return "force_closed";
  }

  const sealDeadline = getBubbleSealDeadline(input.bubble, input.sealAfterMs);

  if (sealDeadline !== null && input.nowMs >= sealDeadline) {
    return "idle_timeout";
  }

  return "force_closed";
}

function hasBubbleLiveSource(bubble: TranslationBubble) {
  return bubble.sourceChunks.some(
    (sourceChunk) => sourceChunk.sourceStatus !== "final",
  );
}
