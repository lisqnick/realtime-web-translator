import type { ScenarioId, SupportedLanguageCode } from "@/types/config";
import type {
  SegmentTranslationStatus,
  SourceSegmentStatus,
  TranslationTriggerReason,
} from "@/types/translation";

export type BubbleStatus = "live" | "stable" | "closed";
export type BubbleCloseReason = BubbleOpenReason | "idle_timeout" | "force_closed";
export type BubbleFinalTranslationStatus =
  | "idle"
  | "streaming"
  | "completed"
  | "failed";
export type BubbleOpenReason =
  | "no_active_bubble"
  | "gap_too_large"
  | "max_chunks_reached"
  | "scenario_changed"
  | "language_changed"
  | "bubble_closed"
  | "other";
export type BubbleDecision = "append_to_existing" | "create_new";

export interface BubbleChunk {
  chunkId: string;
  segmentId: string;
  sourceText: string;
  translatedText: string;
  liveTranslatedText: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
  finalizedAt: number | null;
  committedAt: number | null;
  speechStartedAt: number | null;
  speechStoppedAt: number | null;
  sourceStatus: SourceSegmentStatus;
  translationStatus: SegmentTranslationStatus;
  translatedRevision: number | null;
  activeTranslationRevision: number | null;
  triggerReason: TranslationTriggerReason | null;
  errorMessage: string | null;
}

export interface BubbleDecisionLogEntry {
  chunkId: string;
  segmentId: string;
  sourceText: string;
  createdAt: number;
  finalizedAt: number | null;
  committedAt: number | null;
  speechStartedAt: number | null;
  speechStoppedAt: number | null;
  previousChunkId: string | null;
  computedGapMs: number | null;
  gapComputedFrom: string | null;
  currentActiveBubbleId: string | null;
  currentActiveBubbleChunkCount: number;
  decision: BubbleDecision;
  reason: BubbleOpenReason;
}

export interface BubbleFinalTranslation {
  bubbleId: string;
  sourceText: string;
  translatedText: string;
  status: BubbleFinalTranslationStatus;
  updatedAt: number;
  errorMessage: string | null;
}

export interface TranslationBubble {
  bubbleId: string;
  sourceChunks: BubbleChunk[];
  mergedSourceText: string;
  mergedTranslationText: string;
  createdAt: number;
  updatedAt: number;
  status: BubbleStatus;
  closedAt: number | null;
  closeReason: BubbleCloseReason | null;
  scenario: ScenarioId;
  sourceLanguage: SupportedLanguageCode;
  targetLanguage: SupportedLanguageCode;
  isTranslating: boolean;
  chunkCount: number;
  openedBy: BubbleOpenReason;
  correctionCount: number;
  finalTranslationStatus: BubbleFinalTranslationStatus;
  finalTranslationText: string | null;
  finalTranslationError: string | null;
  errorMessage: string | null;
}

export interface BubbleDebugSnapshot {
  activeBubbleId: string | null;
  activeBubbleChunkCount: number;
  lastChunkGapMs: number | null;
  lastChunkGapBasis: string | null;
  lastOpenReason: BubbleOpenReason | null;
  activeBubbleIsTranslating: boolean;
  activeBubbleCorrectionCount: number;
  recentDecisions: BubbleDecisionLogEntry[];
}

export interface BubbleSnapshot {
  bubbles: TranslationBubble[];
  activeBubbleId: string | null;
  debug: BubbleDebugSnapshot;
}

export interface BubbleAggregationConfig {
  appendWithinMs: number;
  splitAfterMs: number;
  sealAfterMs: number;
  maxChunksPerBubble: number;
  correctionTailSize: number;
}
