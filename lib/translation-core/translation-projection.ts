import type { BubbleDisplayStatus, TranslationBubble } from "@/types/bubble";

export interface BubbleTranslationProjection {
  mergedTranslationText: string;
  displayStatus: BubbleDisplayStatus;
  displayError: string | null;
}

export function projectBubbleTranslation(bubble: TranslationBubble): BubbleTranslationProjection {
  const latestChunkError =
    [...bubble.sourceChunks]
      .reverse()
      .find((sourceChunk) => sourceChunk.errorMessage)?.errorMessage ?? null;

  if (
    bubble.finalTranslationStatus === "completed" &&
    bubble.finalTranslationText?.trim().length
  ) {
    return {
      mergedTranslationText: bubble.finalTranslationText,
      displayStatus: "finalized",
      displayError: null,
    };
  }

  if (bubble.finalTranslationStatus === "streaming") {
    return {
      mergedTranslationText:
        bubble.finalTranslationText?.trim() || bubble.chunkMergedTranslationText,
      displayStatus: "finalizing",
      displayError: null,
    };
  }

  if (bubble.finalTranslationStatus === "failed") {
    return {
      mergedTranslationText: bubble.chunkMergedTranslationText,
      displayStatus: "failed",
      displayError: bubble.finalTranslationError,
    };
  }

  if (bubble.status === "closed") {
    return {
      mergedTranslationText: bubble.chunkMergedTranslationText,
      displayStatus: "sealed",
      displayError: latestChunkError,
    };
  }

  return {
    mergedTranslationText: bubble.chunkMergedTranslationText,
    displayStatus: "collecting",
    displayError: latestChunkError,
  };
}
