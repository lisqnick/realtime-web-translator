import type { ScenarioId, SupportedLanguageCode } from "@/types/config";
import type {
  BubbleAggregationConfig,
  BubbleChunk,
  BubbleDebugSnapshot,
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
      lastOpenReason: null,
      activeBubbleIsTranslating: false,
      activeBubbleCorrectionCount: 0,
    },
  };
}

export function buildBubbleSnapshot(input: {
  transcriptSnapshot: TranscriptStateSnapshot;
  translatedSegments: TranslatedSegment[];
  scenario: ScenarioId;
  sourceLanguage: SupportedLanguageCode;
  targetLanguage: SupportedLanguageCode;
  config?: Partial<BubbleAggregationConfig>;
}): BubbleSnapshot {
  const config = {
    ...DEFAULT_BUBBLE_AGGREGATION_CONFIG,
    ...input.config,
  };

  const translationBySegmentId = new Map(
    input.translatedSegments.map((segment) => [segment.segmentId, segment]),
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

  for (const transcriptSegment of transcriptSegments) {
    const translatedSegment =
      translationBySegmentId.get(transcriptSegment.segmentId) ?? null;
    const chunk = buildBubbleChunk(transcriptSegment, translatedSegment);
    const chunkScenario = translatedSegment?.scenario ?? input.scenario;
    const chunkSourceLanguage =
      translatedSegment?.sourceLanguage ?? input.sourceLanguage;
    const chunkTargetLanguage =
      translatedSegment?.targetLanguage ?? input.targetLanguage;
    const chunkGapMs =
      previousChunk === null ? null : chunk.createdAt - previousChunk.createdAt;

    if (chunkGapMs !== null) {
      lastChunkGapMs = chunkGapMs;
    }

    const nextBubbleReason = decideBubbleBoundary({
      currentBubble,
      chunkGapMs,
      sourceLanguage: chunkSourceLanguage,
      targetLanguage: chunkTargetLanguage,
      scenario: chunkScenario,
      config,
    });

    if (!currentBubble || nextBubbleReason !== null) {
      currentBubble = createBubble({
        firstChunk: chunk,
        sourceLanguage: chunkSourceLanguage,
        targetLanguage: chunkTargetLanguage,
        scenario: chunkScenario,
        openedBy: nextBubbleReason ?? "initial",
      });
      bubbles.push(currentBubble);
    } else {
      currentBubble.sourceChunks.push(chunk);
      currentBubble.chunkCount = currentBubble.sourceChunks.length;
      currentBubble.updatedAt = Math.max(currentBubble.updatedAt, chunk.updatedAt);
    }

    currentBubble.mergedSourceText = joinChunkText(
      currentBubble.sourceChunks,
      (sourceChunk) => sourceChunk.sourceText,
    );
    currentBubble.mergedTranslationText = joinChunkText(
      currentBubble.sourceChunks,
      (sourceChunk) =>
        sourceChunk.translationStatus === "streaming"
          ? sourceChunk.liveTranslatedText || sourceChunk.translatedText
          : sourceChunk.translatedText || sourceChunk.liveTranslatedText,
    );
    currentBubble.isTranslating = currentBubble.sourceChunks.some(
      (sourceChunk) =>
        sourceChunk.translationStatus === "streaming" ||
        sourceChunk.activeTranslationRevision !== null,
    );
    currentBubble.correctionCount = currentBubble.sourceChunks.filter(
      (sourceChunk) => sourceChunk.triggerReason === "revision",
    ).length;
    currentBubble.errorMessage =
      [...currentBubble.sourceChunks]
        .reverse()
        .find((sourceChunk) => sourceChunk.errorMessage)?.errorMessage ?? null;

    previousChunk = chunk;
  }

  const activeBubble = bubbles.at(-1) ?? null;

  for (const [index, bubble] of bubbles.entries()) {
    const isLastBubble = index === bubbles.length - 1;

    bubble.status = deriveBubbleStatus({
      bubble,
      isLastBubble,
    });
  }

  const debug: BubbleDebugSnapshot = {
    activeBubbleId: activeBubble?.bubbleId ?? null,
    activeBubbleChunkCount: activeBubble?.chunkCount ?? 0,
    lastChunkGapMs,
    lastOpenReason: activeBubble?.openedBy ?? null,
    activeBubbleIsTranslating: activeBubble?.isTranslating ?? false,
    activeBubbleCorrectionCount: activeBubble?.correctionCount ?? 0,
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
}): BubbleOpenReason | null {
  if (!input.currentBubble) {
    return "initial";
  }

  if (
    input.currentBubble.sourceLanguage !== input.sourceLanguage ||
    input.currentBubble.targetLanguage !== input.targetLanguage ||
    input.currentBubble.scenario !== input.scenario
  ) {
    return "config_change";
  }

  if (input.currentBubble.chunkCount >= input.config.maxChunksPerBubble) {
    return "max_chunks";
  }

  if (input.chunkGapMs !== null && input.chunkGapMs < input.config.appendWithinMs) {
    return null;
  }

  if (input.chunkGapMs !== null && input.chunkGapMs >= input.config.forceNewAfterMs) {
    return "timeout";
  }

  return null;
}

function deriveBubbleStatus(input: {
  bubble: TranslationBubble;
  isLastBubble: boolean;
}): BubbleStatus {
  if (!input.isLastBubble) {
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
  return chunks
    .map((chunk) => selector(chunk).trim())
    .filter(Boolean)
    .join("\n");
}
