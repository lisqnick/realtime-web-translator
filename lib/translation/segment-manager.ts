import type { TranscriptStateSnapshot } from "@/types/realtime";
import type { ScenarioId, SupportedLanguageCode } from "@/types/config";
import type {
  TranslatedSegment,
  TranslationStateSnapshot,
  TranslationTaskSummary,
  TranslationTriggerReason,
} from "@/types/translation";

interface InternalTranslationState {
  segments: Map<string, TranslatedSegment>;
  orderedSegmentIds: string[];
  translationErrorMessage: string | null;
  activeTasks: TranslationTaskSummary[];
  recentRevisionCount: number;
}

export interface TranslationSegmentManagerSnapshot extends TranslationStateSnapshot {
  activeTasks: TranslationTaskSummary[];
  recentRevisionCount: number;
}

export interface TranslationSegmentManager {
  snapshot: TranslationSegmentManagerSnapshot;
  getSegment: (segmentId: string) => TranslatedSegment | null;
  syncTranscriptSnapshot: (
    snapshot: TranscriptStateSnapshot,
    defaults?: {
      sourceLanguage: SupportedLanguageCode;
      targetLanguage: SupportedLanguageCode;
      scenario: ScenarioId;
    },
  ) => TranslationSegmentManagerSnapshot;
  markSourceStable: (input: {
    segmentId: string;
    revision: number;
  }) => TranslationSegmentManagerSnapshot;
  startTranslation: (input: {
    segmentId: string;
    revision: number;
    triggerReason: TranslationTriggerReason;
    sourceLanguage: TranslatedSegment["sourceLanguage"];
    targetLanguage: TranslatedSegment["targetLanguage"];
    scenario: TranslatedSegment["scenario"];
  }) => TranslationSegmentManagerSnapshot;
  applyDelta: (input: {
    segmentId: string;
    revision: number;
    delta: string;
  }) => TranslationSegmentManagerSnapshot;
  completeTranslation: (input: {
    segmentId: string;
    revision: number;
    text: string;
    sourceText: string;
  }) => TranslationSegmentManagerSnapshot;
  failTranslation: (input: {
    segmentId: string;
    revision: number;
    message: string;
  }) => TranslationSegmentManagerSnapshot;
  supersedeTranslation: (input: {
    segmentId: string;
    revision: number;
  }) => TranslationSegmentManagerSnapshot;
  setSchedulerSnapshot: (input: {
    activeTasks: TranslationTaskSummary[];
    recentRevisionCount: number;
  }) => TranslationSegmentManagerSnapshot;
  clearLive: () => TranslationSegmentManagerSnapshot;
  reset: (options?: {
    preserveCompletedSegments?: boolean;
  }) => TranslationSegmentManagerSnapshot;
}

export function createTranslationSegmentManager(): TranslationSegmentManager {
  let state = createEmptyInternalState();

  const getSnapshot = (): TranslationSegmentManagerSnapshot => {
    const orderedSegments = getOrderedSegments(state);
    const activeStreamingSegment = [...orderedSegments]
      .filter(
        (segment) =>
          segment.translationStatus === "streaming" &&
          segment.liveTranslatedText.trim().length > 0,
      )
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .at(0);

    return {
      liveTranslationText: activeStreamingSegment?.liveTranslatedText ?? "",
      liveTranslationSegmentId: activeStreamingSegment?.segmentId ?? null,
      translatedSegments: orderedSegments,
      translationRequestState: deriveRequestState(state),
      translationErrorMessage: state.translationErrorMessage,
      activeTasks: state.activeTasks,
      recentRevisionCount: state.recentRevisionCount,
    };
  };

  return {
    get snapshot() {
      return getSnapshot();
    },
    getSegment(segmentId) {
      return state.segments.get(segmentId) ?? null;
    },
    syncTranscriptSnapshot(snapshot, defaults) {
      for (const transcriptSegment of snapshot.segments) {
        const existingSegment = state.segments.get(transcriptSegment.segmentId) ?? null;

        if (!existingSegment) {
          ensureOrderedSegmentId(state, transcriptSegment.segmentId);
          state.segments.set(transcriptSegment.segmentId, {
            segmentId: transcriptSegment.segmentId,
            sourceText: transcriptSegment.text,
            sourceStatus: transcriptSegment.status === "final" ? "final" : "live",
            revision: transcriptSegment.revision,
            createdAt: transcriptSegment.createdAt,
            updatedAt: transcriptSegment.updatedAt,
            finalizedAt: transcriptSegment.finalizedAt,
            translationStatus: "idle",
            translatedText: "",
            liveTranslatedText: "",
            translatedSourceText: null,
            translatedRevision: null,
            activeTranslationRevision: null,
            sourceLanguage: defaults?.sourceLanguage ?? "zh-CN",
            targetLanguage: defaults?.targetLanguage ?? "ja-JP",
            scenario: defaults?.scenario ?? "general",
            triggerReason: null,
            errorMessage: null,
          });
          continue;
        }

        state.segments.set(transcriptSegment.segmentId, {
          ...existingSegment,
          sourceText: transcriptSegment.text,
          sourceStatus:
            transcriptSegment.status === "final"
              ? "final"
              : existingSegment.sourceStatus === "stable" &&
                  existingSegment.revision === transcriptSegment.revision
                ? "stable"
                : "live",
          revision: transcriptSegment.revision,
          updatedAt: transcriptSegment.updatedAt,
          finalizedAt: transcriptSegment.finalizedAt,
          sourceLanguage: existingSegment.sourceLanguage ?? defaults?.sourceLanguage ?? "zh-CN",
          targetLanguage: existingSegment.targetLanguage ?? defaults?.targetLanguage ?? "ja-JP",
          scenario: existingSegment.scenario ?? defaults?.scenario ?? "general",
        });
      }

      return getSnapshot();
    },
    markSourceStable(input) {
      const existingSegment = state.segments.get(input.segmentId);

      if (!existingSegment || existingSegment.revision !== input.revision) {
        return getSnapshot();
      }

      state.segments.set(input.segmentId, {
        ...existingSegment,
        sourceStatus: existingSegment.sourceStatus === "final" ? "final" : "stable",
      });
      return getSnapshot();
    },
    startTranslation(input) {
      const existingSegment = state.segments.get(input.segmentId);

      if (!existingSegment) {
        return getSnapshot();
      }

      state.segments.set(input.segmentId, {
        ...existingSegment,
        translationStatus: "streaming",
        liveTranslatedText: "",
        activeTranslationRevision: input.revision,
        sourceLanguage: input.sourceLanguage,
        targetLanguage: input.targetLanguage,
        scenario: input.scenario,
        triggerReason: input.triggerReason,
        errorMessage: null,
      });
      state.translationErrorMessage = null;

      return getSnapshot();
    },
    applyDelta(input) {
      const existingSegment = state.segments.get(input.segmentId);

      if (!existingSegment || existingSegment.activeTranslationRevision !== input.revision) {
        return getSnapshot();
      }

      state.segments.set(input.segmentId, {
        ...existingSegment,
        translationStatus: "streaming",
        liveTranslatedText: `${existingSegment.liveTranslatedText}${input.delta}`,
        errorMessage: null,
      });
      state.translationErrorMessage = null;

      return getSnapshot();
    },
    completeTranslation(input) {
      const existingSegment = state.segments.get(input.segmentId);

      if (!existingSegment || existingSegment.activeTranslationRevision !== input.revision) {
        return getSnapshot();
      }

      state.segments.set(input.segmentId, {
        ...existingSegment,
        translationStatus: "completed",
        translatedText: input.text,
        liveTranslatedText: "",
        translatedSourceText: input.sourceText,
        translatedRevision: input.revision,
        activeTranslationRevision: null,
        updatedAt: Date.now(),
        errorMessage: null,
      });

      return getSnapshot();
    },
    failTranslation(input) {
      const existingSegment = state.segments.get(input.segmentId);

      if (!existingSegment) {
        return getSnapshot();
      }

      state.segments.set(input.segmentId, {
        ...existingSegment,
        translationStatus: "failed",
        liveTranslatedText: "",
        activeTranslationRevision:
          existingSegment.activeTranslationRevision === input.revision
            ? null
            : existingSegment.activeTranslationRevision,
        updatedAt: Date.now(),
        errorMessage: input.message,
      });
      state.translationErrorMessage = input.message;

      return getSnapshot();
    },
    supersedeTranslation(input) {
      const existingSegment = state.segments.get(input.segmentId);

      if (!existingSegment || existingSegment.activeTranslationRevision !== input.revision) {
        return getSnapshot();
      }

      state.segments.set(input.segmentId, {
        ...existingSegment,
        translationStatus: "superseded",
        liveTranslatedText: "",
        activeTranslationRevision: null,
        updatedAt: Date.now(),
      });

      return getSnapshot();
    },
    setSchedulerSnapshot(input) {
      state.activeTasks = input.activeTasks;
      state.recentRevisionCount = input.recentRevisionCount;
      return getSnapshot();
    },
    clearLive() {
      for (const [segmentId, segment] of state.segments.entries()) {
        if (segment.translationStatus === "streaming") {
          state.segments.set(segmentId, {
            ...segment,
            liveTranslatedText: "",
            activeTranslationRevision: null,
          });
        }
      }

      state.activeTasks = [];
      return getSnapshot();
    },
    reset(options) {
      const preserveCompletedSegments = options?.preserveCompletedSegments ?? false;

      if (!preserveCompletedSegments) {
        state = createEmptyInternalState();
        return getSnapshot();
      }

      const preservedSegments = [...state.segments.values()].filter(
        (segment) => segment.translationStatus === "completed" || segment.sourceStatus === "final",
      );

      state = {
        segments: new Map(preservedSegments.map((segment) => [segment.segmentId, segment])),
        orderedSegmentIds: preservedSegments.map((segment) => segment.segmentId),
        translationErrorMessage: null,
        activeTasks: [],
        recentRevisionCount: 0,
      };

      return getSnapshot();
    },
  };
}

function createEmptyInternalState(): InternalTranslationState {
  return {
    segments: new Map(),
    orderedSegmentIds: [],
    translationErrorMessage: null,
    activeTasks: [],
    recentRevisionCount: 0,
  };
}

function deriveRequestState(state: InternalTranslationState) {
  if (state.activeTasks.length > 0) {
    return "streaming";
  }

  if (state.translationErrorMessage) {
    return "error";
  }

  return "idle";
}

function ensureOrderedSegmentId(state: InternalTranslationState, segmentId: string) {
  if (state.orderedSegmentIds.includes(segmentId)) {
    return;
  }

  state.orderedSegmentIds.push(segmentId);
}

function getOrderedSegments(state: InternalTranslationState) {
  const orderedSegments = state.orderedSegmentIds
    .map((segmentId) => state.segments.get(segmentId) ?? null)
    .filter((segment): segment is TranslatedSegment => segment !== null);
  const remainingSegments = [...state.segments.values()].filter(
    (segment) => !state.orderedSegmentIds.includes(segment.segmentId),
  );

  return [...orderedSegments, ...remainingSegments];
}
