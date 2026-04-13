import type {
  ScenarioId,
  SupportedLanguageCode,
  TranslationDirectionMode,
} from "@/types/config";

export type TranslationTriggerReason = "stabilized" | "final" | "revision";

export interface TranslationStreamRequest {
  sourceLanguage: SupportedLanguageCode;
  targetLanguage: SupportedLanguageCode;
  text: string;
  previousContext?: string | null;
  segmentId: string;
  revision: number;
  isFinal: boolean;
  scenario: ScenarioId;
  glossaryId?: string | null;
  triggerReason: TranslationTriggerReason;
}

export type TranslationRequestState = "idle" | "streaming" | "error";

export type TranslationStreamEvent =
  | TranslationStartedEvent
  | TranslationDeltaEvent
  | TranslationCompletedEvent
  | TranslationErrorEvent;

export interface TranslationStartedEvent {
  type: "translation.started";
  segmentId: string;
  revision: number;
}

export interface TranslationDeltaEvent {
  type: "translation.delta";
  segmentId: string;
  revision: number;
  delta: string;
  text: string;
}

export interface TranslationCompletedEvent {
  type: "translation.completed";
  segmentId: string;
  revision: number;
  text: string;
}

export interface TranslationErrorEvent {
  type: "translation.error";
  segmentId: string;
  revision: number;
  message: string;
}

export type SourceSegmentStatus = "live" | "stable" | "final";
export type SegmentTranslationStatus =
  | "idle"
  | "streaming"
  | "completed"
  | "superseded"
  | "failed";

export interface TranslatedSegment {
  segmentId: string;
  sourceText: string;
  sourceStatus: SourceSegmentStatus;
  revision: number;
  createdAt: number;
  updatedAt: number;
  finalizedAt: number | null;
  translationStatus: SegmentTranslationStatus;
  translatedText: string;
  liveTranslatedText: string;
  translatedSourceText: string | null;
  translatedRevision: number | null;
  activeTranslationRevision: number | null;
  sourceLanguage: SupportedLanguageCode;
  targetLanguage: SupportedLanguageCode;
  scenario: ScenarioId;
  triggerReason: TranslationTriggerReason | null;
  errorMessage: string | null;
}

export interface TranslationTaskSummary {
  segmentId: string;
  revision: number;
  reason: TranslationTriggerReason;
  status: "queued" | "streaming";
}

export interface TranslationStateSnapshot {
  liveTranslationText: string;
  liveTranslationSegmentId: string | null;
  translatedSegments: TranslatedSegment[];
  translationRequestState: TranslationRequestState;
  translationErrorMessage: string | null;
}

export interface TranslationPromptInput {
  directionMode: TranslationDirectionMode;
  sourceLanguage: SupportedLanguageCode;
  targetLanguage: SupportedLanguageCode;
  scenario: ScenarioId;
  text: string;
  previousContext?: string | null;
  glossaryHints?: string[];
}

export interface TranslationPrompt {
  instructions: string;
  inputText: string;
  glossaryHints: string[];
}

export interface TranslationScheduleRequest {
  segmentId: string;
  revision: number;
  sourceText: string;
  sourceLanguage: SupportedLanguageCode;
  targetLanguage: SupportedLanguageCode;
  previousContext?: string | null;
  scenario: ScenarioId;
  isFinal: boolean;
  reason: TranslationTriggerReason;
}
