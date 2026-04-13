import type {
  ScenarioId,
  SelectedLanguagePair,
  SupportedLanguageCode,
  TranslationDirectionMode,
} from "@/types/config";
import type { TranslationJobKind, TranslationTriggerReason } from "@/types/translation";

export type TranslationDirectionResolutionStatus =
  | "resolved"
  | "uncertain"
  | "rejected";

export interface ResolvedTranslationDirection {
  resolvedSourceLanguage: SupportedLanguageCode;
  resolvedTargetLanguage: SupportedLanguageCode;
  confidence: number;
  status: TranslationDirectionResolutionStatus;
}

export interface TranslationExecutionRequest {
  jobKind: TranslationJobKind;
  jobId: string;
  directionMode: TranslationDirectionMode;
  selectedLanguagePair: SelectedLanguagePair;
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

export interface AutomaticTranslationStructuredOutput {
  detected_source_language: SupportedLanguageCode;
  translation: string;
}
