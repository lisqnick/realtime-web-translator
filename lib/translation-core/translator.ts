import { streamSegmentTranslation } from "@/lib/translation/api";
import type {
  TranslationStreamEvent,
  TranslationScheduleRequest,
  TranslationStreamRequest,
} from "@/types/translation";

import { createBubbleFinalizeJob, createSegmentFirstPassJob } from "@/lib/translation-core/translation-jobs";

export async function streamTranslationJob(options: {
  request: TranslationScheduleRequest;
  signal?: AbortSignal;
  onEvent: (event: TranslationStreamEvent) => void;
}) {
  return streamSegmentTranslation({
    request: toTranslationStreamRequest(options.request),
    signal: options.signal,
    onEvent: options.onEvent,
  });
}

export async function translateSegmentFirstPass(options: {
  request: Parameters<typeof createSegmentFirstPassJob>[0];
  signal?: AbortSignal;
  onEvent: (event: TranslationStreamEvent) => void;
}) {
  return streamTranslationJob({
    request: createSegmentFirstPassJob(options.request),
    signal: options.signal,
    onEvent: options.onEvent,
  });
}

export async function translateBubbleFinalize(options: {
  request: Parameters<typeof createBubbleFinalizeJob>[0];
  signal?: AbortSignal;
  onEvent: (event: TranslationStreamEvent) => void;
}) {
  return streamTranslationJob({
    request: createBubbleFinalizeJob(options.request),
    signal: options.signal,
    onEvent: options.onEvent,
  });
}

export function toTranslationStreamRequest(
  request: TranslationScheduleRequest,
): TranslationStreamRequest {
  return {
    jobKind: request.jobKind,
    jobId: request.jobId,
    directionMode: request.directionMode,
    selectedLanguagePair: request.selectedLanguagePair,
    sourceLanguage: request.sourceLanguage,
    targetLanguage: request.targetLanguage,
    text: request.sourceText,
    previousContext: request.previousContext ?? null,
    segmentId: request.segmentId,
    revision: request.revision,
    isFinal: request.isFinal,
    scenario: request.scenario,
    triggerReason: request.reason,
  };
}
