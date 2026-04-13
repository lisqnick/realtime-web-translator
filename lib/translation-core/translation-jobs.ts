import type {
  ScenarioId,
  SupportedLanguageCode,
  TranslationDirectionMode,
} from "@/types/config";
import type {
  TranslationJobKind,
  TranslationScheduleRequest,
  TranslationTriggerReason,
} from "@/types/translation";

import { createSelectedLanguagePair } from "@/lib/translation-core/direction-resolver";

export function createSegmentFirstPassJob(input: {
  segmentId: string;
  revision: number;
  sourceText: string;
  directionMode: TranslationDirectionMode;
  sourceLanguage: SupportedLanguageCode;
  targetLanguage: SupportedLanguageCode;
  previousContext?: string | null;
  scenario: ScenarioId;
  isFinal: boolean;
  reason: TranslationTriggerReason;
}): TranslationScheduleRequest {
  return {
    jobKind: "segment_first_pass",
    jobId: buildSegmentJobId(input.segmentId, input.revision),
    segmentId: input.segmentId,
    revision: input.revision,
    sourceText: input.sourceText,
    directionMode: input.directionMode,
    selectedLanguagePair: createSelectedLanguagePair({
      directionMode: input.directionMode,
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
    }),
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage,
    previousContext: input.previousContext ?? null,
    scenario: input.scenario,
    isFinal: input.isFinal,
    reason: input.reason,
  };
}

export function createBubbleFinalizeJob(input: {
  bubbleId: string;
  revision: number;
  sourceText: string;
  directionMode: TranslationDirectionMode;
  sourceLanguage: SupportedLanguageCode;
  targetLanguage: SupportedLanguageCode;
  previousContext?: string | null;
  scenario: ScenarioId;
}): TranslationScheduleRequest {
  return {
    jobKind: "bubble_finalize",
    jobId: buildBubbleFinalizeJobId(input.bubbleId),
    segmentId: input.bubbleId,
    revision: input.revision,
    sourceText: input.sourceText,
    directionMode: input.directionMode,
    selectedLanguagePair: createSelectedLanguagePair({
      directionMode: input.directionMode,
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
    }),
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage,
    previousContext: input.previousContext ?? null,
    scenario: input.scenario,
    isFinal: true,
    reason: "final",
  };
}

export function buildSegmentJobId(segmentId: string, revision: number) {
  return `segment:${segmentId}:${revision}`;
}

export function buildBubbleFinalizeJobId(bubbleId: string) {
  return `bubble:${bubbleId}:finalize`;
}

export function isTranslationJobKind(
  value: string | undefined,
): value is TranslationJobKind {
  return value === "segment_first_pass" || value === "bubble_finalize";
}

export function isSegmentFirstPassJob(request: {
  jobKind: TranslationJobKind;
}): request is { jobKind: "segment_first_pass" } {
  return request.jobKind === "segment_first_pass";
}

export function isBubbleFinalizeJob(request: {
  jobKind: TranslationJobKind;
}): request is { jobKind: "bubble_finalize" } {
  return request.jobKind === "bubble_finalize";
}
