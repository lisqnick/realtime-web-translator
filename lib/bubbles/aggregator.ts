import type { ScenarioId, SupportedLanguageCode } from "@/types/config";
import type {
  BubbleAggregationConfig,
  BubbleChunk,
  BubbleDecisionLogEntry,
  BubbleDebugSnapshot,
  BubbleFinalTranslation,
  BubbleOpenReason,
  BubbleSnapshot,
  BubbleStatus,
  TranslationBubble,
} from "@/types/bubble";
import type { TranscriptStateSnapshot } from "@/types/realtime";
import type { TranslatedSegment } from "@/types/translation";

const DEFAULT_BUBBLE_AGGREGATION_CONFIG: BubbleAggregationConfig = {
  appendWithinMs: 1200,
  forceNewAfterMs: 1500,
  maxChunksPerBubble: 5,
  correctionTailSize: 2,
};
const MAX_BUBBLE_DECISION_LOGS = 16;

export function getDefaultBubbleAggregationConfig(): BubbleAggregationConfig {
  return DEFAULT_BUBBLE_AGGREGATION_CONFIG;
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
}): BubbleSnapshot {
  const config = {
    ...DEFAULT_BUBBLE_AGGREGATION_CONFIG,
    ...input.config,
  };

  const translationBySegmentId = new Map(
    input.translatedSegments.map((segment) => [segment.segmentId, segment]),
  );
  const bubbleFinalTranslationById = new Map(
    (input.bubbleFinalTranslations ?? []).map((translation) => [translation.bubbleId, translation]),
  );
  const transcriptSegments = input.transcriptSnapshot.segments.filter((segment) =>
    segment.text.trim(),
  );

  if (transcriptSegments.length === 0) {
    return createEmptyBubbleSnapshot();
  }

  const bubbles: TranslationBubble[] = [];
  let currentBubble: TranslationBubble | null = null;
  let previousChunk: BubbleChunk | null = null;
  let lastChunkGapMs: number | null = null;
  let lastChunkGapBasis: string | null = null;
  const decisionLog: BubbleDecisionLogEntry[] = [];

  for (const transcriptSegment of transcriptSegments) {
    const translatedSegment =
      translationBySegmentId.get(transcriptSegment.segmentId) ?? null;
    const chunk = buildBubbleChunk(transcriptSegment, translatedSegment);
    const chunkScenario = translatedSegment?.scenario ?? input.scenario;
    const chunkSourceLanguage =
      translatedSegment?.sourceLanguage ?? input.sourceLanguage;
    const chunkTargetLanguage =
      translatedSegment?.targetLanguage ?? input.targetLanguage;
    const chunkGap = computeChunkGap(previousChunk, chunk);

    if (chunkGap.gapMs !== null) {
      lastChunkGapMs = chunkGap.gapMs;
      lastChunkGapBasis = chunkGap.basis;
    }

    const bubbleDecision = decideBubbleBoundary({
      currentBubble,
      chunkGapMs: chunkGap.gapMs,
      sourceLanguage: chunkSourceLanguage,
      targetLanguage: chunkTargetLanguage,
      scenario: chunkScenario,
      config,
    });
    decisionLog.push({
      chunkId: chunk.chunkId,
      segmentId: chunk.segmentId,
      sourceText: truncateSourceText(chunk.sourceText),
      createdAt: chunk.createdAt,
      finalizedAt: chunk.finalizedAt,
      committedAt: chunk.committedAt,
      speechStartedAt: chunk.speechStartedAt,
      speechStoppedAt: chunk.speechStoppedAt,
      previousChunkId: previousChunk?.chunkId ?? null,
      computedGapMs: chunkGap.gapMs,
      gapComputedFrom: chunkGap.basis,
      currentActiveBubbleId: currentBubble?.bubbleId ?? null,
      currentActiveBubbleChunkCount: currentBubble?.chunkCount ?? 0,
      decision: bubbleDecision.decision,
      reason: bubbleDecision.reason,
    });

    if (bubbleDecision.decision === "create_new") {
      currentBubble = createBubble({
        firstChunk: chunk,
        sourceLanguage: chunkSourceLanguage,
        targetLanguage: chunkTargetLanguage,
        scenario: chunkScenario,
        openedBy: bubbleDecision.reason,
      });
      bubbles.push(currentBubble);
    } else {
      const existingBubble: TranslationBubble | null = currentBubble;

      if (!existingBubble) {
        previousChunk = chunk;
        continue;
      }

      existingBubble.sourceChunks.push(chunk);
      existingBubble.chunkCount = existingBubble.sourceChunks.length;
      existingBubble.updatedAt = Math.max(existingBubble.updatedAt, chunk.updatedAt);
      currentBubble = existingBubble;
    }

    if (!currentBubble) {
      previousChunk = chunk;
      continue;
    }

    currentBubble.mergedSourceText = joinChunkText(
      currentBubble.sourceChunks,
      (sourceChunk) => sourceChunk.sourceText,
    );
    const chunkMergedTranslationText = joinChunkText(
      currentBubble.sourceChunks,
      (sourceChunk) =>
        sourceChunk.translationStatus === "streaming"
          ? sourceChunk.liveTranslatedText || sourceChunk.translatedText
          : sourceChunk.translatedText || sourceChunk.liveTranslatedText,
    );
    const bubbleFinalTranslation = resolveBubbleFinalTranslation(
      bubbleFinalTranslationById.get(currentBubble.bubbleId) ?? null,
      currentBubble.mergedSourceText,
    );
    currentBubble.finalTranslationStatus = bubbleFinalTranslation?.status ?? "idle";
    currentBubble.finalTranslationText =
      bubbleFinalTranslation?.status === "completed" &&
      bubbleFinalTranslation.translatedText.trim().length > 0
        ? bubbleFinalTranslation.translatedText
        : null;
    currentBubble.finalTranslationError =
      bubbleFinalTranslation?.status === "failed"
        ? bubbleFinalTranslation.errorMessage
        : null;
    currentBubble.mergedTranslationText =
      currentBubble.finalTranslationText ?? chunkMergedTranslationText;
    currentBubble.isTranslating = currentBubble.sourceChunks.some(
      (sourceChunk) =>
        sourceChunk.translationStatus === "streaming" ||
        sourceChunk.activeTranslationRevision !== null,
    ) || currentBubble.finalTranslationStatus === "streaming";
    currentBubble.correctionCount = currentBubble.sourceChunks.filter(
      (sourceChunk) => sourceChunk.triggerReason === "revision",
    ).length;
    currentBubble.errorMessage =
      currentBubble.finalTranslationError ??
      [...currentBubble.sourceChunks]
        .reverse()
        .find((sourceChunk) => sourceChunk.errorMessage)?.errorMessage ??
      null;

    previousChunk = chunk;
  }

  const activeBubble = bubbles.at(-1) ?? null;

  for (const [index, bubble] of bubbles.entries()) {
    const isLastBubble = index === bubbles.length - 1;

    bubble.status = deriveBubbleStatus({
      bubble,
      isLastBubble,
      forceCloseActiveBubble: input.forceCloseActiveBubble ?? false,
    });
  }

  const debug: BubbleDebugSnapshot = {
    activeBubbleId: activeBubble?.bubbleId ?? null,
    activeBubbleChunkCount: activeBubble?.chunkCount ?? 0,
    lastChunkGapMs,
    lastChunkGapBasis,
    lastOpenReason: activeBubble?.openedBy ?? null,
    activeBubbleIsTranslating: activeBubble?.isTranslating ?? false,
    activeBubbleCorrectionCount: activeBubble?.correctionCount ?? 0,
    recentDecisions: decisionLog.slice(-MAX_BUBBLE_DECISION_LOGS),
  };

  return {
    bubbles,
    activeBubbleId: activeBubble?.bubbleId ?? null,
    debug,
  };
}

export function getBubbleTailSegmentIds(
  bubbles: TranslationBubble[],
  segmentId: string,
  tailSize = DEFAULT_BUBBLE_AGGREGATION_CONFIG.correctionTailSize,
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

function buildBubbleChunk(
  transcriptSegment: TranscriptStateSnapshot["segments"][number],
  translatedSegment: TranslatedSegment | null,
): BubbleChunk {
  return {
    chunkId: transcriptSegment.segmentId,
    segmentId: transcriptSegment.segmentId,
    sourceText: transcriptSegment.text,
    translatedText: translatedSegment?.translatedText ?? "",
    liveTranslatedText: translatedSegment?.liveTranslatedText ?? "",
    revision: transcriptSegment.revision,
    createdAt: transcriptSegment.createdAt,
    updatedAt: Math.max(
      transcriptSegment.updatedAt,
      translatedSegment?.updatedAt ?? transcriptSegment.updatedAt,
    ),
    finalizedAt: transcriptSegment.finalizedAt,
    committedAt: transcriptSegment.committedAt,
    speechStartedAt: transcriptSegment.speechStartedAt,
    speechStoppedAt: transcriptSegment.speechStoppedAt,
    sourceStatus: translatedSegment?.sourceStatus ?? transcriptSegment.status,
    translationStatus: translatedSegment?.translationStatus ?? "idle",
    translatedRevision: translatedSegment?.translatedRevision ?? null,
    activeTranslationRevision: translatedSegment?.activeTranslationRevision ?? null,
    triggerReason: translatedSegment?.triggerReason ?? null,
    errorMessage: translatedSegment?.errorMessage ?? null,
  };
}

function createBubble(input: {
  firstChunk: BubbleChunk;
  sourceLanguage: SupportedLanguageCode;
  targetLanguage: SupportedLanguageCode;
  scenario: ScenarioId;
  openedBy: BubbleOpenReason;
}): TranslationBubble {
  return {
    bubbleId: `bubble:${input.firstChunk.segmentId}`,
    sourceChunks: [input.firstChunk],
    mergedSourceText: input.firstChunk.sourceText,
    mergedTranslationText:
      input.firstChunk.translationStatus === "streaming"
        ? input.firstChunk.liveTranslatedText || input.firstChunk.translatedText
        : input.firstChunk.translatedText || input.firstChunk.liveTranslatedText,
    createdAt: input.firstChunk.createdAt,
    updatedAt: input.firstChunk.updatedAt,
    status: "live",
    scenario: input.scenario,
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage,
    isTranslating:
      input.firstChunk.translationStatus === "streaming" ||
      input.firstChunk.activeTranslationRevision !== null,
    chunkCount: 1,
    openedBy: input.openedBy,
    correctionCount: input.firstChunk.triggerReason === "revision" ? 1 : 0,
    finalTranslationStatus: "idle",
    finalTranslationText: null,
    finalTranslationError: null,
    errorMessage: input.firstChunk.errorMessage,
  };
}

function decideBubbleBoundary(input: {
  currentBubble: TranslationBubble | null;
  chunkGapMs: number | null;
  sourceLanguage: SupportedLanguageCode;
  targetLanguage: SupportedLanguageCode;
  scenario: ScenarioId;
  config: BubbleAggregationConfig;
}): {
  decision: "append_to_existing" | "create_new";
  reason: BubbleOpenReason;
} {
  if (!input.currentBubble) {
    return {
      decision: "create_new",
      reason: "no_active_bubble",
    };
  }

  if (input.currentBubble.status === "closed") {
    return {
      decision: "create_new",
      reason: "bubble_closed",
    };
  }

  if (
    input.currentBubble.sourceLanguage !== input.sourceLanguage ||
    input.currentBubble.targetLanguage !== input.targetLanguage
  ) {
    return {
      decision: "create_new",
      reason: "language_changed",
    };
  }

  if (input.currentBubble.scenario !== input.scenario) {
    return {
      decision: "create_new",
      reason: "scenario_changed",
    };
  }

  if (input.currentBubble.chunkCount >= input.config.maxChunksPerBubble) {
    return {
      decision: "create_new",
      reason: "max_chunks_reached",
    };
  }

  if (input.chunkGapMs !== null && input.chunkGapMs >= input.config.forceNewAfterMs) {
    return {
      decision: "create_new",
      reason: "gap_too_large",
    };
  }

  return {
    decision: "append_to_existing",
    reason: "other",
  };
}

function deriveBubbleStatus(input: {
  bubble: TranslationBubble;
  isLastBubble: boolean;
  forceCloseActiveBubble: boolean;
}): BubbleStatus {
  if (!input.isLastBubble) {
    return "closed";
  }

  if (input.forceCloseActiveBubble) {
    return "closed";
  }

  const hasLiveSource = input.bubble.sourceChunks.some(
    (sourceChunk) => sourceChunk.sourceStatus !== "final",
  );

  return hasLiveSource || input.bubble.isTranslating ? "live" : "stable";
}

function joinChunkText(
  chunks: BubbleChunk[],
  selector: (chunk: BubbleChunk) => string,
) {
  return chunks.reduce((mergedText, chunk) => {
    const nextText = selector(chunk).trim();

    if (!nextText) {
      return mergedText;
    }

    if (!mergedText) {
      return nextText;
    }

    const separator = getChunkSeparator(mergedText, nextText);
    return `${mergedText}${separator}${nextText}`;
  }, "");
}

function computeChunkGap(previousChunk: BubbleChunk | null, nextChunk: BubbleChunk) {
  if (!previousChunk) {
    return {
      gapMs: null,
      basis: null,
    };
  }

  const candidates: Array<{
    start: number | null;
    end: number | null;
    basis: string;
  }> = [
    {
      start: previousChunk.speechStoppedAt,
      end: nextChunk.speechStartedAt,
      basis: "previous.speechStoppedAt -> current.speechStartedAt",
    },
    {
      start: previousChunk.speechStoppedAt,
      end: nextChunk.committedAt,
      basis: "previous.speechStoppedAt -> current.committedAt",
    },
    {
      start: previousChunk.committedAt,
      end: nextChunk.speechStartedAt,
      basis: "previous.committedAt -> current.speechStartedAt",
    },
    {
      start: previousChunk.committedAt,
      end: nextChunk.committedAt,
      basis: "previous.committedAt -> current.committedAt",
    },
    {
      start: previousChunk.finalizedAt,
      end: nextChunk.createdAt,
      basis: "previous.finalizedAt -> current.createdAt",
    },
    {
      start: previousChunk.createdAt,
      end: nextChunk.createdAt,
      basis: "previous.createdAt -> current.createdAt",
    },
  ];

  for (const candidate of candidates) {
    if (candidate.start === null || candidate.end === null) {
      continue;
    }

    if (candidate.end < candidate.start) {
      continue;
    }

    return {
      gapMs: candidate.end - candidate.start,
      basis: candidate.basis,
    };
  }

  return {
    gapMs: null,
    basis: null,
  };
}

function truncateSourceText(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();

  if (normalized.length <= 48) {
    return normalized;
  }

  return `${normalized.slice(0, 48)}...`;
}

function resolveBubbleFinalTranslation(
  translation: BubbleFinalTranslation | null,
  mergedSourceText: string,
) {
  if (!translation || translation.sourceText !== mergedSourceText) {
    return null;
  }

  return translation;
}

function getChunkSeparator(previousText: string, nextText: string) {
  const previousChar = previousText.trim().slice(-1);
  const nextChar = nextText.trim().charAt(0);

  if (!previousChar || !nextChar) {
    return "";
  }

  if (/\s$/.test(previousText)) {
    return "";
  }

  if (/[A-Za-z0-9]$/.test(previousText) && /^[A-Za-z0-9]/.test(nextText)) {
    return " ";
  }

  if (/[\u3002.!?！？…]$/.test(previousText)) {
    return "";
  }

  if (/[,，、；;：:]$/.test(previousText)) {
    return "";
  }

  if (/^[,，、。！？!?]/.test(nextText)) {
    return "";
  }

  return "";
}
