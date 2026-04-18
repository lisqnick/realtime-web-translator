"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";

import { TRANSLATION_CORE_CONFIG } from "@/config/translation-core";
import type {
  ScenarioId,
  SupportedLanguageCode,
  TranslationDirectionMode,
} from "@/types/config";
import type {
  BubbleFinalTranslation,
  BubbleSnapshot,
  TranslationBubble,
} from "@/types/bubble";
import type {
  AudioRuntimeMode,
  ParsedRealtimeEvent,
  RealtimeBrowserConnection,
  RealtimeConnectionSnapshot,
  RealtimeControllerState,
  RealtimeTimelineEntry,
  TranscriptPerfSnapshot,
  TranscriptStateSnapshot,
} from "@/types/realtime";
import type { TranslationTriggerReason } from "@/types/translation";
import type { TranslationSegmentManagerSnapshot } from "@/lib/translation/segment-manager";

import {
  buildBubbleSnapshot,
  createEmptyBubbleSnapshot,
  getDefaultBubbleAggregationConfig,
} from "@/lib/bubbles/aggregator";
import {
  evaluateBubbleFinalTranslationPolicy,
  isImmediateBubbleFinalTranslationCloseReason,
} from "@/lib/bubbles/final-translation-policy";
import { getBubbleSealDeadline } from "@/lib/bubbles/sealing";
import {
  createEmptyTranscriptPerfSnapshot,
  markTranscriptPerf,
} from "@/lib/perf/transcript-metrics";
import { createTranscriptBuffer } from "@/lib/realtime/buffer";
import {
  assertRealtimeBrowserSupport,
  connectRealtimeSession,
  describeMediaAccessError,
  RealtimeBrowserError,
  requestMicrophoneStream,
} from "@/lib/realtime/browser";
import { parseRealtimeEvent } from "@/lib/realtime/parser";
import { requestRealtimeSession } from "@/lib/realtime/api";
import {
  appendRealtimeTimelineEntry,
  createRealtimeTimelineEntry,
} from "@/lib/realtime/timeline";
import { createTranscriptStabilizer } from "@/lib/stabilizer";
import {
  createBubbleFinalizeJob,
  createSegmentFirstPassJob,
} from "@/lib/translation-core/translation-jobs";
import { createSelectedLanguagePair } from "@/lib/translation-core/direction-resolver";
import { createTranslationSegmentManager } from "@/lib/translation/segment-manager";
import { createTranslationScheduler } from "@/lib/translation/scheduler";

type ControllerAction =
  | {
      type: "status";
      appStatus: RealtimeControllerState["appStatus"];
      connectionStatus?: RealtimeControllerState["connectionStatus"];
    }
  | {
      type: "mic_permission";
      micPermissionStatus: RealtimeControllerState["micPermissionStatus"];
    }
  | {
      type: "session_ready";
      sessionId: string;
      sessionExpiresAt: number | null;
      sessionModel: string;
      sessionAudioRuntimeMode: AudioRuntimeMode;
      sessionTurnDetectionType: string;
      sessionSilenceDurationMs: number;
    }
  | {
      type: "snapshot";
      snapshot: RealtimeConnectionSnapshot;
    }
  | {
      type: "transcript_snapshot";
      transcriptSnapshot: TranscriptStateSnapshot;
    }
  | {
      type: "perf_snapshot";
      perfSnapshot: TranscriptPerfSnapshot;
    }
  | {
      type: "timeline_snapshot";
      timeline: RealtimeTimelineEntry[];
    }
  | {
      type: "bubble_snapshot";
      bubbleSnapshot: BubbleSnapshot;
    }
  | {
      type: "translation_snapshot";
      translationSnapshot: ReturnType<
        ReturnType<typeof createTranslationSegmentManager>["reset"]
      >;
    }
  | {
      type: "error";
      message: string;
      micPermissionStatus?: RealtimeControllerState["micPermissionStatus"];
      micAccessErrorName?: string | null;
      micAccessErrorMessage?: string | null;
    }
  | {
      type: "clear_error";
    }
  | {
      type: "start_attempt";
      timestamp: number;
      blockedByStatus: RealtimeControllerState["appStatus"] | null;
    }
  | {
      type: "reset";
      preserveFinalizedSegments?: boolean;
      preserveTranslatedSegments?: boolean;
    };

const initialState: RealtimeControllerState = {
  appStatus: "idle",
  connectionStatus: "disconnected",
  micPermissionStatus: "not_requested",
  errorMessage: null,
  micAccessErrorName: null,
  micAccessErrorMessage: null,
  startAttemptCount: 0,
  lastStartAttemptAt: null,
  lastStartBlockedByStatus: null,
  liveSourceText: "",
  finalizedSegments: [],
  liveTranslationText: "",
  liveTranslationSegmentId: null,
  translatedSegments: [],
  translationRequestState: "idle",
  translationErrorMessage: null,
  activeTranslationTasks: [],
  recentRevisionCount: 0,
  bubbles: [],
  activeBubbleId: null,
  bubbleDebug: createEmptyBubbleSnapshot().debug,
  sessionId: null,
  sessionExpiresAt: null,
  sessionModel: null,
  sessionAudioRuntimeMode: null,
  sessionTurnDetectionType: null,
  sessionSilenceDurationMs: null,
  peerConnectionState: "new",
  iceConnectionState: "new",
  signalingState: "stable",
  dataChannelState: "closed",
  lastRealtimeEventType: null,
  perfSnapshot: createEmptyTranscriptPerfSnapshot(),
  realtimeEventTimeline: [],
};

function isBackgroundStopRelevantStatus(appStatus: RealtimeControllerState["appStatus"]) {
  return (
    appStatus === "requesting_mic" ||
    appStatus === "creating_session" ||
    appStatus === "connecting_realtime" ||
    appStatus === "listening"
  );
}

function reducer(
  state: RealtimeControllerState,
  action: ControllerAction,
): RealtimeControllerState {
  switch (action.type) {
    case "status":
      return {
        ...state,
        appStatus: action.appStatus,
        connectionStatus: action.connectionStatus ?? state.connectionStatus,
      };
    case "mic_permission":
      return {
        ...state,
        micPermissionStatus: action.micPermissionStatus,
      };
    case "session_ready":
      return {
        ...state,
        sessionId: action.sessionId,
        sessionExpiresAt: action.sessionExpiresAt,
        sessionModel: action.sessionModel,
        sessionAudioRuntimeMode: action.sessionAudioRuntimeMode,
        sessionTurnDetectionType: action.sessionTurnDetectionType,
        sessionSilenceDurationMs: action.sessionSilenceDurationMs,
      };
    case "snapshot":
      return {
        ...state,
        connectionStatus: action.snapshot.connectionStatus,
        peerConnectionState: action.snapshot.peerConnectionState,
        iceConnectionState: action.snapshot.iceConnectionState,
        signalingState: action.snapshot.signalingState,
        dataChannelState: action.snapshot.dataChannelState,
        lastRealtimeEventType: action.snapshot.lastEventType,
      };
    case "transcript_snapshot":
      return {
        ...state,
        liveSourceText: action.transcriptSnapshot.liveSourceText,
        finalizedSegments: action.transcriptSnapshot.finalizedSegments,
      };
    case "perf_snapshot":
      return {
        ...state,
        perfSnapshot: action.perfSnapshot,
      };
    case "timeline_snapshot":
      return {
        ...state,
        realtimeEventTimeline: action.timeline,
      };
    case "bubble_snapshot":
      return {
        ...state,
        bubbles: action.bubbleSnapshot.bubbles,
        activeBubbleId: action.bubbleSnapshot.activeBubbleId,
        bubbleDebug: action.bubbleSnapshot.debug,
      };
    case "translation_snapshot":
      return {
        ...state,
        liveTranslationText: action.translationSnapshot.liveTranslationText,
        liveTranslationSegmentId: action.translationSnapshot.liveTranslationSegmentId,
        translatedSegments: action.translationSnapshot.translatedSegments,
        translationRequestState: action.translationSnapshot.translationRequestState,
        translationErrorMessage: action.translationSnapshot.translationErrorMessage,
        activeTranslationTasks: action.translationSnapshot.activeTasks,
        recentRevisionCount: action.translationSnapshot.recentRevisionCount,
      };
    case "error":
      return {
        ...state,
        appStatus: "error",
        connectionStatus: "error",
        errorMessage: action.message,
        micPermissionStatus: action.micPermissionStatus ?? state.micPermissionStatus,
        micAccessErrorName: action.micAccessErrorName ?? null,
        micAccessErrorMessage: action.micAccessErrorMessage ?? null,
      };
    case "clear_error":
      return {
        ...state,
        errorMessage: null,
        micAccessErrorName: null,
        micAccessErrorMessage: null,
      };
    case "start_attempt":
      return {
        ...state,
        startAttemptCount: state.startAttemptCount + 1,
        lastStartAttemptAt: action.timestamp,
        lastStartBlockedByStatus: action.blockedByStatus,
      };
    case "reset":
      return {
        ...state,
        appStatus: "stopped",
        connectionStatus: "disconnected",
        errorMessage: null,
        micAccessErrorName: null,
        micAccessErrorMessage: null,
        startAttemptCount: state.startAttemptCount,
        lastStartAttemptAt: state.lastStartAttemptAt,
        lastStartBlockedByStatus: state.lastStartBlockedByStatus,
        liveSourceText: "",
        finalizedSegments: action.preserveFinalizedSegments ? state.finalizedSegments : [],
        liveTranslationText: "",
        liveTranslationSegmentId: null,
        translatedSegments: action.preserveTranslatedSegments ? state.translatedSegments : [],
        translationRequestState: "idle",
        translationErrorMessage: null,
        activeTranslationTasks: [],
        recentRevisionCount: action.preserveTranslatedSegments ? state.recentRevisionCount : 0,
        bubbles: state.bubbles,
        activeBubbleId: state.activeBubbleId,
        bubbleDebug: state.bubbleDebug,
        sessionId: null,
        sessionExpiresAt: null,
        sessionModel: state.sessionModel,
        sessionAudioRuntimeMode: state.sessionAudioRuntimeMode,
        sessionTurnDetectionType: state.sessionTurnDetectionType,
        sessionSilenceDurationMs: state.sessionSilenceDurationMs,
        peerConnectionState: "new",
        iceConnectionState: "new",
        signalingState: "stable",
        dataChannelState: "closed",
        lastRealtimeEventType: null,
        perfSnapshot: action.preserveFinalizedSegments
          ? state.perfSnapshot
          : createEmptyTranscriptPerfSnapshot(),
        realtimeEventTimeline: state.realtimeEventTimeline,
      };
  }
}

export function useRealtimeController(options: {
  directionMode: TranslationDirectionMode;
  sourceLanguage: SupportedLanguageCode;
  targetLanguage: SupportedLanguageCode;
  scenario: ScenarioId;
  audioRuntimeMode: AudioRuntimeMode;
  debugPerfLogs?: boolean;
}) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const debugPerfLogsRef = useRef(options.debugPerfLogs ?? false);
  const appStatusRef = useRef(initialState.appStatus);
  const stopRef = useRef<(() => void) | null>(null);

  const activeConnectionRef = useRef<RealtimeBrowserConnection | null>(null);
  const pendingStreamRef = useRef<MediaStream | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const operationIdRef = useRef(0);
  const transcriptBufferRef = useRef(createTranscriptBuffer());
  const perfSnapshotRef = useRef(createEmptyTranscriptPerfSnapshot());
  const realtimeTimelineRef = useRef<RealtimeTimelineEntry[]>([]);
  const bubbleSnapshotRef = useRef(createEmptyBubbleSnapshot());
  const bubbleFinalTranslationsRef = useRef<Map<string, BubbleFinalTranslation>>(new Map());
  const bubbleFinalTranslationTriggeredRef = useRef<Set<string>>(new Set());
  const bubbleDeferredFinalTranslationTimersRef = useRef<Map<string, number>>(new Map());
  const bubbleSealTimerRef = useRef<number | null>(null);
  const backgroundHiddenSinceRef = useRef<number | null>(null);
  const backgroundStopTimerRef = useRef<number | null>(null);
  const backgroundStopTriggeredRef = useRef(false);
  const forceCloseActiveBubbleRef = useRef(false);
  const stabilizerRef = useRef(createTranscriptStabilizer());
  const translationSegmentManagerRef = useRef(createTranslationSegmentManager());
  const translationSchedulerRef = useRef<ReturnType<typeof createTranslationScheduler> | null>(
    null,
  );
  const bubbleAggregationConfig = getDefaultBubbleAggregationConfig();
  const bubbleSealAfterMs = bubbleAggregationConfig.sealAfterMs;
  const bubbleFinalTranslateAfterMs = bubbleAggregationConfig.finalTranslateAfterMs;

  const markPerf = useCallback((key: keyof TranscriptPerfSnapshot) => {
    const nextPerfSnapshot = markTranscriptPerf(perfSnapshotRef.current, key, {
      debug: debugPerfLogsRef.current,
    });

    if (nextPerfSnapshot === perfSnapshotRef.current) {
      return;
    }

    perfSnapshotRef.current = nextPerfSnapshot;
    dispatch({
      type: "perf_snapshot",
      perfSnapshot: nextPerfSnapshot,
    });
  }, []);

  const getSelectedLanguagePair = useCallback(
    () =>
      createSelectedLanguagePair({
        directionMode: options.directionMode,
        sourceLanguage: options.sourceLanguage,
        targetLanguage: options.targetLanguage,
      }),
    [options.directionMode, options.sourceLanguage, options.targetLanguage],
  );

  const clearBubbleSealTimer = useCallback(() => {
    if (bubbleSealTimerRef.current === null) {
      return;
    }

    window.clearTimeout(bubbleSealTimerRef.current);
    bubbleSealTimerRef.current = null;
  }, []);

  const clearBackgroundStopTimer = useCallback(() => {
    if (backgroundStopTimerRef.current === null) {
      return;
    }

    window.clearTimeout(backgroundStopTimerRef.current);
    backgroundStopTimerRef.current = null;
  }, []);

  const maybeAutoStopForBackground = useCallback(
    (options?: { allowVisible?: boolean }) => {
      const hiddenSince = backgroundHiddenSinceRef.current;

      if (hiddenSince === null) {
        return false;
      }

      if (
        !options?.allowVisible &&
        typeof document !== "undefined" &&
        !document.hidden &&
        document.visibilityState === "visible"
      ) {
        return false;
      }

      if (!isBackgroundStopRelevantStatus(appStatusRef.current)) {
        return false;
      }

      if (Date.now() - hiddenSince < TRANSLATION_CORE_CONFIG.backgroundAutoStopMs) {
        return false;
      }

      if (backgroundStopTriggeredRef.current) {
        return false;
      }

      backgroundStopTriggeredRef.current = true;
      stopRef.current?.();
      return true;
    },
    [],
  );

  const scheduleBackgroundStop = useCallback(() => {
    clearBackgroundStopTimer();

    if (!isBackgroundStopRelevantStatus(appStatusRef.current)) {
      return;
    }

    const hiddenSince = backgroundHiddenSinceRef.current;

    if (hiddenSince === null) {
      return;
    }

    const delayMs = Math.max(
      0,
      TRANSLATION_CORE_CONFIG.backgroundAutoStopMs - (Date.now() - hiddenSince),
    );

    backgroundStopTimerRef.current = window.setTimeout(() => {
      backgroundStopTimerRef.current = null;
      void maybeAutoStopForBackground();
    }, delayMs);
  }, [clearBackgroundStopTimer, maybeAutoStopForBackground]);

  const clearDeferredBubbleFinalTranslationTimer = useCallback((bubbleId: string) => {
    const timerId = bubbleDeferredFinalTranslationTimersRef.current.get(bubbleId);

    if (timerId === undefined) {
      return;
    }

    window.clearTimeout(timerId);
    bubbleDeferredFinalTranslationTimersRef.current.delete(bubbleId);
  }, []);

  const clearDeferredBubbleFinalTranslationTimers = useCallback(() => {
    for (const timerId of bubbleDeferredFinalTranslationTimersRef.current.values()) {
      window.clearTimeout(timerId);
    }

    bubbleDeferredFinalTranslationTimersRef.current.clear();
  }, []);

  const publishBubbleSnapshot = useCallback(
    (input?: {
      transcriptSnapshot?: TranscriptStateSnapshot;
      translationSnapshot?: TranslationSegmentManagerSnapshot;
      nowMs?: number;
    }) => {
      const selectedLanguagePair = getSelectedLanguagePair();
      const bubbleSnapshot = buildBubbleSnapshot({
        transcriptSnapshot: input?.transcriptSnapshot ?? transcriptBufferRef.current.snapshot,
        translatedSegments:
          (input?.translationSnapshot ?? translationSegmentManagerRef.current.snapshot)
            .translatedSegments,
        bubbleFinalTranslations: [...bubbleFinalTranslationsRef.current.values()],
        scenario: options.scenario,
        sourceLanguage: selectedLanguagePair.languages[0],
        targetLanguage: selectedLanguagePair.languages[1],
        forceCloseActiveBubble: forceCloseActiveBubbleRef.current,
        nowMs: input?.nowMs,
      });

      const previousBubbleSnapshot = bubbleSnapshotRef.current;
      bubbleSnapshotRef.current = bubbleSnapshot;
      dispatch({
        type: "bubble_snapshot",
        bubbleSnapshot,
      });

      return {
        bubbleSnapshot,
        previousBubbleSnapshot,
      };
    },
    [getSelectedLanguagePair, options.scenario],
  );

  const buildBubblePreviousContext = useCallback((bubbleId: string) => {
    const bubbles = bubbleSnapshotRef.current.bubbles;
    const bubbleIndex = bubbles.findIndex((bubble) => bubble.bubbleId === bubbleId);

    if (bubbleIndex <= 0) {
      return null;
    }

    const previousText = bubbles
      .slice(Math.max(0, bubbleIndex - 1), bubbleIndex)
      .map((bubble) => bubble.mergedSourceText.trim())
      .filter(Boolean);

    return previousText.length > 0 ? previousText.join("\n") : null;
  }, []);

  const scheduleBubbleFinalTranslation = useCallback(
    async (bubble: TranslationBubble) => {
      const sourceText = bubble.mergedSourceText.trim();

      if (!sourceText) {
        return false;
      }

      const existingTranslation = bubbleFinalTranslationsRef.current.get(bubble.bubbleId);

      if (
        existingTranslation &&
        existingTranslation.sourceText === sourceText &&
        (existingTranslation.status === "streaming" ||
          existingTranslation.status === "completed")
      ) {
        return false;
      }

      bubbleFinalTranslationTriggeredRef.current.add(bubble.bubbleId);

      const scheduled =
        (await translationSchedulerRef.current?.scheduleTranslation(
          createBubbleFinalizeJob({
            bubbleId: bubble.bubbleId,
            revision: bubble.chunkCount,
            sourceText,
            directionMode: options.directionMode,
            sourceLanguage: bubble.sourceLanguage,
            targetLanguage: bubble.targetLanguage,
            previousContext: buildBubblePreviousContext(bubble.bubbleId),
            scenario: bubble.scenario,
          }),
        )) ?? false;

      if (!scheduled) {
        bubbleFinalTranslationTriggeredRef.current.delete(bubble.bubbleId);
      }

      return scheduled;
    },
    [buildBubblePreviousContext, options.directionMode],
  );

  const syncBubbleSnapshot = useCallback(
    (input?: {
      transcriptSnapshot?: TranscriptStateSnapshot;
      translationSnapshot?: TranslationSegmentManagerSnapshot;
      nowMs?: number;
    }) => {
      const { bubbleSnapshot, previousBubbleSnapshot } = publishBubbleSnapshot(input);
      const previousBubbleStatusById = new Map(
        previousBubbleSnapshot.bubbles.map((bubble) => [bubble.bubbleId, bubble.status]),
      );
      const previousBubbleCloseReasonById = new Map(
        previousBubbleSnapshot.bubbles.map((bubble) => [bubble.bubbleId, bubble.closeReason]),
      );

      const triggerBubbleFinalTranslationNow = (bubble: TranslationBubble) => {
        clearDeferredBubbleFinalTranslationTimer(bubble.bubbleId);

        if (bubbleFinalTranslationTriggeredRef.current.has(bubble.bubbleId)) {
          return;
        }

        void scheduleBubbleFinalTranslation(bubble);
      };

      const scheduleDeferredBubbleFinalTranslation = (bubble: TranslationBubble) => {
        if (bubbleFinalTranslationTriggeredRef.current.has(bubble.bubbleId)) {
          return;
        }

        if (bubbleDeferredFinalTranslationTimersRef.current.has(bubble.bubbleId)) {
          return;
        }

        const baseClosedAt = bubble.closedAt ?? Date.now();
        const delayMs = Math.max(
          0,
          baseClosedAt + (bubbleFinalTranslateAfterMs - bubbleSealAfterMs) - Date.now(),
        );
        const timerId = window.setTimeout(() => {
          bubbleDeferredFinalTranslationTimersRef.current.delete(bubble.bubbleId);

          const latestBubble = bubbleSnapshotRef.current.bubbles.find(
            (candidate) => candidate.bubbleId === bubble.bubbleId,
          );

          if (!latestBubble) {
            return;
          }

          if (bubbleFinalTranslationTriggeredRef.current.has(latestBubble.bubbleId)) {
            return;
          }

          const latestDecision = evaluateBubbleFinalTranslationPolicy(latestBubble);

          if (!latestDecision.shouldRun || latestDecision.schedule !== "deferred") {
            return;
          }

          void scheduleBubbleFinalTranslation(latestBubble);
        }, delayMs);

        bubbleDeferredFinalTranslationTimersRef.current.set(bubble.bubbleId, timerId);
      };

      for (const bubble of bubbleSnapshot.bubbles) {
        const previousStatus = previousBubbleStatusById.get(bubble.bubbleId);
        const previousCloseReason =
          previousBubbleCloseReasonById.get(bubble.bubbleId) ?? null;
        const isFirstClosed =
          bubble.status === "closed" && previousStatus !== "closed";
        const promotedFromIdleTimeout =
          bubble.status === "closed" &&
          previousStatus === "closed" &&
          previousCloseReason === "idle_timeout" &&
          bubble.closeReason !== "idle_timeout" &&
          isImmediateBubbleFinalTranslationCloseReason(bubble.closeReason);

        const finalTranslationDecision =
          evaluateBubbleFinalTranslationPolicy(bubble);

        if (!isFirstClosed && !promotedFromIdleTimeout) {
          continue;
        }

        if (!finalTranslationDecision.shouldRun) {
          continue;
        }

        if (finalTranslationDecision.schedule === "immediate") {
          triggerBubbleFinalTranslationNow(bubble);
          continue;
        }

        scheduleDeferredBubbleFinalTranslation(bubble);
      }
    },
    [
      bubbleFinalTranslateAfterMs,
      bubbleSealAfterMs,
      clearDeferredBubbleFinalTranslationTimer,
      publishBubbleSnapshot,
      scheduleBubbleFinalTranslation,
    ],
  );

  const syncTranslationSnapshot = useCallback(
    (
      translationSnapshot: TranslationSegmentManagerSnapshot,
      transcriptSnapshot?: TranscriptStateSnapshot,
    ) => {
      dispatch({
        type: "translation_snapshot",
        translationSnapshot,
      });
      syncBubbleSnapshot({
        translationSnapshot,
        transcriptSnapshot,
      });
    },
    [syncBubbleSnapshot],
  );

  const syncRealtimeTimeline = useCallback((timeline: RealtimeTimelineEntry[]) => {
    realtimeTimelineRef.current = timeline;
    dispatch({
      type: "timeline_snapshot",
      timeline,
    });
  }, []);

  const cleanupPendingStream = useCallback(() => {
    const pendingStream = pendingStreamRef.current;
    pendingStreamRef.current = null;

    if (!pendingStream) {
      return;
    }

    for (const track of pendingStream.getTracks()) {
      try {
        track.stop();
      } catch {
        // Ignore cleanup failures during teardown.
      }
    }
  }, []);

  const resetTranscriptSession = useCallback(() => {
    forceCloseActiveBubbleRef.current = false;
    clearBubbleSealTimer();
    clearDeferredBubbleFinalTranslationTimers();
    bubbleFinalTranslationsRef.current.clear();
    bubbleFinalTranslationTriggeredRef.current.clear();
    bubbleSnapshotRef.current = createEmptyBubbleSnapshot();
    stabilizerRef.current.reset();

    const transcriptSnapshot = transcriptBufferRef.current.reset();
    dispatch({
      type: "transcript_snapshot",
      transcriptSnapshot,
    });

    perfSnapshotRef.current = createEmptyTranscriptPerfSnapshot();
    dispatch({
      type: "perf_snapshot",
      perfSnapshot: perfSnapshotRef.current,
    });
    syncRealtimeTimeline([]);
    syncBubbleSnapshot({
      transcriptSnapshot,
    });
  }, [
    clearDeferredBubbleFinalTranslationTimers,
    clearBubbleSealTimer,
    syncBubbleSnapshot,
    syncRealtimeTimeline,
  ]);

  const resetTranslationSession = useCallback(
    (options?: { preserveCompletedSegments?: boolean }) => {
      translationSchedulerRef.current?.reset();

      const translationSnapshot = translationSegmentManagerRef.current.reset({
        preserveCompletedSegments: options?.preserveCompletedSegments ?? false,
      });
      syncTranslationSnapshot(translationSnapshot);
    },
    [syncTranslationSnapshot],
  );

  const clearLiveTranscriptOnly = useCallback(() => {
    const transcriptSnapshot = transcriptBufferRef.current.clearLive();
    dispatch({
      type: "transcript_snapshot",
      transcriptSnapshot,
    });
    syncBubbleSnapshot({
      transcriptSnapshot,
    });
  }, [syncBubbleSnapshot]);

  const clearLiveTranslationOnly = useCallback(() => {
    const translationSnapshot = translationSegmentManagerRef.current.clearLive();
    syncTranslationSnapshot(translationSnapshot);
  }, [syncTranslationSnapshot]);

  const recordRealtimeEvent = useCallback(
    (event: Parameters<typeof createRealtimeTimelineEntry>[0]) => {
      const timelineEntry = createRealtimeTimelineEntry(event, {
        micStartAt: perfSnapshotRef.current.micStartAt,
      });

      if (!timelineEntry) {
        return;
      }

      const nextTimeline = appendRealtimeTimelineEntry(
        realtimeTimelineRef.current,
        timelineEntry,
      );
      syncRealtimeTimeline(nextTimeline);

      if (debugPerfLogsRef.current) {
        console.info("[realtime:timeline]", {
          eventType: timelineEntry.eventType,
          itemId: timelineEntry.itemId,
          contentIndex: timelineEntry.contentIndex,
          arrivedAt: new Date(timelineEntry.arrivedAt).toISOString(),
          elapsedMsFromMicStart: timelineEntry.elapsedMsFromMicStart,
          textLength: timelineEntry.textLength,
        });
      }
    },
    [syncRealtimeTimeline],
  );

  const buildPreviousContext = useCallback(
    (segments: TranscriptStateSnapshot["finalizedSegments"], segmentId: string) => {
      const segmentIndex = segments.findIndex((segment) => segment.segmentId === segmentId);

      if (segmentIndex <= 0) {
        return null;
      }

      const previousSegments = segments
        .slice(Math.max(0, segmentIndex - 2), segmentIndex)
        .map((segment) => segment.text.trim())
        .filter(Boolean);

      return previousSegments.length > 0 ? previousSegments.join("\n") : null;
    },
    [],
  );

  const scheduleTranslation = useCallback(
    async (input: {
      transcriptSnapshot: TranscriptStateSnapshot;
      segmentId: string;
      revision: number;
      sourceText: string;
      isFinal: boolean;
      reason: TranslationTriggerReason;
    }) => {
      if (!input.sourceText.trim()) {
        return false;
      }

      if (input.reason === "stabilized") {
        markPerf("firstStableTriggerAt");
        const translationSnapshot = translationSegmentManagerRef.current.markSourceStable({
          segmentId: input.segmentId,
          revision: input.revision,
        });
        syncTranslationSnapshot(translationSnapshot);
      }

      const scheduled =
        (await translationSchedulerRef.current?.scheduleTranslation(
          createSegmentFirstPassJob({
            segmentId: input.segmentId,
            revision: input.revision,
            sourceText: input.sourceText,
            directionMode: options.directionMode,
            sourceLanguage: getSelectedLanguagePair().languages[0],
            targetLanguage: getSelectedLanguagePair().languages[1],
            previousContext: buildPreviousContext(
              input.transcriptSnapshot.finalizedSegments,
              input.segmentId,
            ),
            scenario: options.scenario,
            isFinal: input.isFinal,
            reason: input.reason,
          }),
        )) ?? false;

      stabilizerRef.current.markTriggered({
        segmentId: input.segmentId,
        revision: input.revision,
        sourceText: input.sourceText,
        reason: input.reason,
        isFinal: input.isFinal,
      });

      if (debugPerfLogsRef.current) {
        console.info("[translation] schedule", {
          segmentId: input.segmentId,
          revision: input.revision,
          reason: input.reason,
          isFinal: input.isFinal,
          scheduled,
        });
      }

      return scheduled;
    },
    [
      buildPreviousContext,
      markPerf,
      options.directionMode,
      options.scenario,
      getSelectedLanguagePair,
      syncTranslationSnapshot,
    ],
  );

  const handleSuggestion = useCallback(
    async (
      transcriptSnapshot: TranscriptStateSnapshot,
      suggestion: {
        segmentId: string;
        revision: number;
        sourceText: string;
        reason: TranslationTriggerReason;
        isFinal: boolean;
      },
    ) => {
      const transcriptSegment = transcriptSnapshot.segments.find(
        (segment) =>
          segment.segmentId === suggestion.segmentId &&
          segment.revision === suggestion.revision,
      );

      if (!transcriptSegment) {
        return;
      }

      if (suggestion.reason === "stabilized") {
        await scheduleTranslation({
          transcriptSnapshot,
          segmentId: suggestion.segmentId,
          revision: suggestion.revision,
          sourceText: suggestion.sourceText,
          isFinal: false,
          reason: "stabilized",
        });
        return;
      }

      const translationSegment =
        translationSegmentManagerRef.current.getSegment(suggestion.segmentId);
      const selectedLanguagePair = getSelectedLanguagePair();
      const bubbleSnapshot = buildBubbleSnapshot({
        transcriptSnapshot,
        translatedSegments: translationSegmentManagerRef.current.snapshot.translatedSegments,
        scenario: options.scenario,
        sourceLanguage: selectedLanguagePair.languages[0],
        targetLanguage: selectedLanguagePair.languages[1],
      });
      const containingBubble =
        bubbleSnapshot.bubbles.find((bubble) =>
          bubble.sourceChunks.some((chunk) => chunk.segmentId === suggestion.segmentId),
        ) ?? null;
      const hasExistingSegmentTranslation =
        translationSegment?.translatedRevision !== null ||
        translationSegment?.activeTranslationRevision !== null;

      if (
        containingBubble?.status !== "closed" &&
        hasExistingSegmentTranslation
      ) {
        if (debugPerfLogsRef.current) {
          console.info("[translation] skipped segment revision before bubble close", {
            segmentId: suggestion.segmentId,
            revision: suggestion.revision,
            bubbleId: containingBubble?.bubbleId ?? null,
            bubbleStatus: containingBubble?.status ?? null,
          });
        }

        return;
      }

      if (hasExistingSegmentTranslation) {
        if (debugPerfLogsRef.current) {
          console.info("[translation] skipped segment revision after existing final", {
            segmentId: suggestion.segmentId,
            revision: suggestion.revision,
            bubbleId: containingBubble?.bubbleId ?? null,
            bubbleStatus: containingBubble?.status ?? null,
          });
        }

        return;
      }

      await scheduleTranslation({
        transcriptSnapshot,
        segmentId: suggestion.segmentId,
        revision: suggestion.revision,
        sourceText: suggestion.sourceText,
        isFinal: true,
        reason: "final",
      });
    },
    [getSelectedLanguagePair, options.scenario, scheduleTranslation],
  );

  const applyTranscriptEvent = useCallback(
    (event: ParsedRealtimeEvent) => {
      if (event.kind === "ignored") {
        return;
      }

      if (event.kind === "invalid") {
        if (debugPerfLogsRef.current) {
          console.warn("[realtime] Ignored invalid transcript event", {
            type: event.type,
            reason: event.reason,
          });
        }
        return;
      }

      const transcriptSnapshot = transcriptBufferRef.current.applyEvent(event);
      dispatch({
        type: "transcript_snapshot",
        transcriptSnapshot,
      });

      const selectedLanguagePair = getSelectedLanguagePair();
      const translationSnapshot =
        translationSegmentManagerRef.current.syncTranscriptSnapshot(transcriptSnapshot, {
          sourceLanguage: selectedLanguagePair.languages[0],
          targetLanguage: selectedLanguagePair.languages[1],
          scenario: options.scenario,
        });
      syncTranslationSnapshot(translationSnapshot, transcriptSnapshot);

      if (event.kind === "transcript_delta") {
        markPerf("firstPartialTranscriptAt");

        return;
      }

      if (event.kind === "transcript_segment") {
        if (debugPerfLogsRef.current) {
          console.info("[realtime] Ignored transcript segment event for live source rendering", {
            itemId: event.itemId,
            contentIndex: event.contentIndex,
            textLength: event.text.length,
          });
        }

        return;
      }

      if (event.kind === "transcript_completed") {
        markPerf("firstFinalTranscriptAt");

        if (debugPerfLogsRef.current) {
          console.info("[realtime] Final transcript segment", {
            itemId: event.itemId,
            contentIndex: event.contentIndex,
            textLength: event.transcript.length,
          });
        }

        const finalizedSegment = transcriptSnapshot.finalizedSegments.find(
          (segment) =>
            segment.itemId === event.itemId && segment.contentIndex === event.contentIndex,
        );

        if (finalizedSegment) {
          void handleSuggestion(transcriptSnapshot, {
            segmentId: finalizedSegment.segmentId,
            revision: finalizedSegment.revision,
            sourceText: finalizedSegment.text,
            reason: "final",
            isFinal: true,
          });
        }
      }
    },
    [
      handleSuggestion,
      getSelectedLanguagePair,
      markPerf,
      options.scenario,
      syncTranslationSnapshot,
    ],
  );

  const stop = useCallback(() => {
    operationIdRef.current += 1;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;

    translationSchedulerRef.current?.reset();
    clearBubbleSealTimer();
    clearBackgroundStopTimer();
    clearDeferredBubbleFinalTranslationTimers();
    backgroundHiddenSinceRef.current = null;
    backgroundStopTriggeredRef.current = false;
    forceCloseActiveBubbleRef.current = true;

    dispatch({
      type: "status",
      appStatus: "stopping",
      connectionStatus: "disconnected",
    });

    activeConnectionRef.current?.disconnect();
    activeConnectionRef.current = null;
    cleanupPendingStream();
    clearLiveTranscriptOnly();
    clearLiveTranslationOnly();
    resetTranslationSession({
      preserveCompletedSegments: true,
    });

    dispatch({
      type: "reset",
      preserveFinalizedSegments: true,
      preserveTranslatedSegments: true,
    });
  }, [
    clearBackgroundStopTimer,
    clearDeferredBubbleFinalTranslationTimers,
    clearBubbleSealTimer,
    cleanupPendingStream,
    clearLiveTranscriptOnly,
    clearLiveTranslationOnly,
    resetTranslationSession,
  ]);

  const start = useCallback(async () => {
    if (
      state.appStatus === "requesting_mic" ||
      state.appStatus === "creating_session" ||
      state.appStatus === "connecting_realtime" ||
      state.appStatus === "listening" ||
      state.appStatus === "stopping"
    ) {
      dispatch({
        type: "start_attempt",
        timestamp: Date.now(),
        blockedByStatus: state.appStatus,
      });

      if (debugPerfLogsRef.current) {
        console.info("[ui] start ignored because controller is busy", {
          appStatus: state.appStatus,
        });
      }

      return;
    }

    dispatch({
      type: "start_attempt",
      timestamp: Date.now(),
      blockedByStatus: null,
    });
    dispatch({
      type: "status",
      appStatus: "requesting_mic",
      connectionStatus: "disconnected",
    });
    dispatch({
      type: "mic_permission",
      micPermissionStatus: "prompt",
    });

    if (debugPerfLogsRef.current) {
      console.info("[ui] start clicked, transitioning to requesting_mic");
    }

    const currentOperationId = operationIdRef.current + 1;
    operationIdRef.current = currentOperationId;
    backgroundHiddenSinceRef.current = null;
    backgroundStopTriggeredRef.current = false;
    clearBackgroundStopTimer();
    dispatch({ type: "clear_error" });
    resetTranscriptSession();
    resetTranslationSession();
    markPerf("micStartAt");

    try {
      assertRealtimeBrowserSupport();
    } catch (error) {
      const message =
        error instanceof RealtimeBrowserError &&
        (error.code === "unsupported_microphone" || error.code === "insecure_context")
          ? "当前页面不是安全上下文，或浏览器环境不支持麦克风采集。"
          : error instanceof Error
            ? error.message
            : "当前浏览器不支持 Realtime 所需能力。";
      dispatch({
        type: "error",
        message,
        micPermissionStatus: "unsupported",
        micAccessErrorName: error instanceof Error ? error.name : "UnknownError",
        micAccessErrorMessage: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    let microphoneGranted = false;

    try {
      const microphoneStream = await requestMicrophoneStream();

      if (operationIdRef.current !== currentOperationId) {
        for (const track of microphoneStream.getTracks()) {
          track.stop();
        }
        return;
      }

      pendingStreamRef.current = microphoneStream;
      microphoneGranted = true;
      dispatch({
        type: "mic_permission",
        micPermissionStatus: "granted",
      });
      dispatch({
        type: "status",
        appStatus: "creating_session",
        connectionStatus: "creating_session",
      });

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      const realtimeSession = await requestRealtimeSession({
        sourceLanguage:
          options.directionMode === "auto_selected_pair" ? undefined : options.sourceLanguage,
        audioRuntimeMode: options.audioRuntimeMode,
        signal: abortController.signal,
      });

      if (operationIdRef.current !== currentOperationId) {
        cleanupPendingStream();
        return;
      }

      dispatch({
        type: "session_ready",
        sessionId: realtimeSession.session.id,
        sessionExpiresAt: realtimeSession.clientSecret.expiresAt,
        sessionModel: realtimeSession.session.model,
        sessionAudioRuntimeMode: realtimeSession.session.audioRuntimeMode,
        sessionTurnDetectionType: realtimeSession.session.turnDetection.type,
        sessionSilenceDurationMs: realtimeSession.session.turnDetection.silenceDurationMs,
      });
      dispatch({
        type: "status",
        appStatus: "connecting_realtime",
        connectionStatus: "connecting",
      });

      const connection = await connectRealtimeSession({
        mediaStream: microphoneStream,
        session: realtimeSession,
        signal: abortController.signal,
        callbacks: {
          onSnapshot: (snapshot) => {
            if (operationIdRef.current !== currentOperationId) {
              return;
            }

            dispatch({
              type: "snapshot",
              snapshot,
            });

            if (snapshot.connectionStatus === "connected") {
              markPerf("realtimeConnectedAt");
            }

            if (snapshot.connectionStatus === "disconnected") {
              activeConnectionRef.current = null;
              clearBubbleSealTimer();
              clearDeferredBubbleFinalTranslationTimers();
              forceCloseActiveBubbleRef.current = true;
              clearLiveTranscriptOnly();
              resetTranslationSession({
                preserveCompletedSegments: true,
              });
              dispatch({
                type: "status",
                appStatus: "stopped",
                connectionStatus: "disconnected",
              });
            }

            if (snapshot.connectionStatus === "error") {
              activeConnectionRef.current = null;
              clearBubbleSealTimer();
              clearDeferredBubbleFinalTranslationTimers();
              forceCloseActiveBubbleRef.current = true;
              clearLiveTranscriptOnly();
              resetTranslationSession({
                preserveCompletedSegments: true,
              });
              dispatch({
                type: "error",
                message: "Realtime 连接已中断，请重新点击开始。",
                micPermissionStatus: microphoneGranted ? "granted" : "error",
              });
            }
          },
          onEvent: (event) => {
            if (operationIdRef.current !== currentOperationId) {
              return;
            }

            recordRealtimeEvent(event);

            if (debugPerfLogsRef.current) {
              const eventType = typeof event.type === "string" ? event.type : "unknown";

              if (
                eventType === "input_audio_buffer.speech_started" ||
                eventType === "input_audio_buffer.speech_stopped" ||
                eventType === "input_audio_buffer.committed" ||
                eventType.startsWith("conversation.item.input_audio_transcription") ||
                eventType === "error"
              ) {
                console.info("[realtime] Server event", {
                  type: eventType,
                  itemId: typeof event.item_id === "string" ? event.item_id : null,
                  contentIndex:
                    typeof event.content_index === "number" ? event.content_index : null,
                  deltaLength: typeof event.delta === "string" ? event.delta.length : null,
                  transcriptLength:
                    typeof event.transcript === "string" ? event.transcript.length : null,
                  textLength: typeof event.text === "string" ? event.text.length : null,
                });
              }
            }

            const parsedEvent = parseRealtimeEvent(event);
            applyTranscriptEvent(parsedEvent);
          },
        },
      });

      if (operationIdRef.current !== currentOperationId) {
        connection.disconnect();
        return;
      }

      activeConnectionRef.current = connection;
      pendingStreamRef.current = null;
      abortControllerRef.current = null;

      dispatch({
        type: "status",
        appStatus: "listening",
        connectionStatus: "connected",
      });
    } catch (error) {
      cleanupPendingStream();
      translationSchedulerRef.current?.reset();
      activeConnectionRef.current?.disconnect();
      activeConnectionRef.current = null;
      abortControllerRef.current = null;

      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      const mediaAccessError = describeMediaAccessError(error);

      if (mediaAccessError) {
        dispatch({
          type: "error",
          message: mediaAccessError.message,
          micPermissionStatus: mediaAccessError.micPermissionStatus,
          micAccessErrorName: error instanceof Error ? error.name : "UnknownError",
          micAccessErrorMessage: error instanceof Error ? error.message : String(error),
        });
        return;
      }

      if (error instanceof RealtimeBrowserError) {
        dispatch({
          type: "error",
          message:
            error.code === "unsupported_microphone" || error.code === "insecure_context"
              ? "当前页面不是安全上下文，或浏览器环境不支持麦克风采集。"
              : error.message,
          micPermissionStatus:
            error.code === "unsupported_microphone" ||
            error.code === "unsupported_webrtc" ||
            error.code === "insecure_context"
              ? "unsupported"
              : microphoneGranted
                ? "granted"
                : "error",
          micAccessErrorName: error.name,
          micAccessErrorMessage: error.message,
        });
        return;
      }

      const message =
        error instanceof Error ? error.message : "建立 Realtime 连接时发生未知错误。";

      dispatch({
        type: "error",
        message,
        micPermissionStatus: microphoneGranted ? "granted" : "error",
        micAccessErrorName: error instanceof Error ? error.name : "UnknownError",
        micAccessErrorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }, [
    applyTranscriptEvent,
    cleanupPendingStream,
    clearBackgroundStopTimer,
    clearDeferredBubbleFinalTranslationTimers,
    clearBubbleSealTimer,
    clearLiveTranscriptOnly,
    markPerf,
    options.audioRuntimeMode,
    options.directionMode,
    options.sourceLanguage,
    recordRealtimeEvent,
    resetTranscriptSession,
    resetTranslationSession,
    state.appStatus,
  ]);

  useEffect(() => {
    debugPerfLogsRef.current = options.debugPerfLogs ?? false;
  }, [options.debugPerfLogs]);

  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);

  useEffect(() => {
    appStatusRef.current = state.appStatus;

    if (!isBackgroundStopRelevantStatus(state.appStatus)) {
      clearBackgroundStopTimer();
      backgroundHiddenSinceRef.current = null;
      backgroundStopTriggeredRef.current = false;
      return;
    }

    backgroundStopTriggeredRef.current = false;

    if (typeof document !== "undefined" && document.hidden) {
      if (backgroundHiddenSinceRef.current === null) {
        backgroundHiddenSinceRef.current = Date.now();
      }

      scheduleBackgroundStop();
    }
  }, [clearBackgroundStopTimer, scheduleBackgroundStop, state.appStatus]);

  useEffect(() => {
    if (translationSchedulerRef.current !== null) {
      return;
    }

    translationSchedulerRef.current = createTranslationScheduler(
      {
        onSnapshot: (snapshot) => {
          const translationSnapshot = translationSegmentManagerRef.current.setSchedulerSnapshot({
            activeTasks: snapshot.activeTasks,
            recentRevisionCount: snapshot.recentRevisionCount,
          });
          syncTranslationSnapshot(translationSnapshot);
        },
        onRequestStarted: (request) => {
          markPerf("firstTranslationRequestAt");

          if (request.jobKind === "bubble_finalize") {
            const existingTranslation =
              bubbleFinalTranslationsRef.current.get(request.segmentId) ?? null;

            bubbleFinalTranslationsRef.current.set(request.segmentId, {
              bubbleId: request.segmentId,
              sourceText: request.sourceText,
              translatedText: existingTranslation?.translatedText ?? "",
              status: "streaming",
              updatedAt: Date.now(),
              errorMessage: null,
            });
            syncBubbleSnapshot({
              transcriptSnapshot: transcriptBufferRef.current.snapshot,
              translationSnapshot: translationSegmentManagerRef.current.snapshot,
            });
            return;
          }

          const translationSnapshot = translationSegmentManagerRef.current.startTranslation({
            segmentId: request.segmentId,
            revision: request.revision,
            triggerReason: request.reason,
            sourceLanguage: request.sourceLanguage,
            targetLanguage: request.targetLanguage,
            scenario: request.scenario,
          });
          syncTranslationSnapshot(translationSnapshot);
        },
        onDelta: (event) => {
          markPerf("firstTranslationDeltaAt");

          if (event.request.jobKind === "bubble_finalize") {
            bubbleFinalTranslationsRef.current.set(event.request.segmentId, {
              bubbleId: event.request.segmentId,
              sourceText: event.request.sourceText,
              translatedText: event.text,
              status: "streaming",
              updatedAt: Date.now(),
              errorMessage: null,
            });
            syncBubbleSnapshot({
              transcriptSnapshot: transcriptBufferRef.current.snapshot,
              translationSnapshot: translationSegmentManagerRef.current.snapshot,
            });
            return;
          }

          const translationSnapshot = translationSegmentManagerRef.current.applyDelta({
            segmentId: event.request.segmentId,
            revision: event.request.revision,
            delta: event.delta,
          });
          syncTranslationSnapshot(translationSnapshot);
        },
        onCompleted: (event) => {
          markPerf("firstTranslationCompleteAt");

          if (event.request.jobKind === "bubble_finalize") {
            bubbleFinalTranslationsRef.current.set(event.request.segmentId, {
              bubbleId: event.request.segmentId,
              sourceText: event.sourceText,
              translatedText: event.text,
              status: "completed",
              updatedAt: Date.now(),
              errorMessage: null,
            });
            syncBubbleSnapshot({
              transcriptSnapshot: transcriptBufferRef.current.snapshot,
              translationSnapshot: translationSegmentManagerRef.current.snapshot,
            });
            return;
          }

          const translationSnapshot = translationSegmentManagerRef.current.completeTranslation({
            segmentId: event.request.segmentId,
            revision: event.request.revision,
            text: event.text,
            sourceText: event.sourceText,
          });
          syncTranslationSnapshot(translationSnapshot);
        },
        onError: (event) => {
          if (event.request.jobKind === "bubble_finalize") {
            const existingTranslation =
              bubbleFinalTranslationsRef.current.get(event.request.segmentId) ?? null;

            bubbleFinalTranslationsRef.current.set(event.request.segmentId, {
              bubbleId: event.request.segmentId,
              sourceText: event.request.sourceText,
              translatedText: existingTranslation?.translatedText ?? "",
              status: "failed",
              updatedAt: Date.now(),
              errorMessage: event.message,
            });
            syncBubbleSnapshot({
              transcriptSnapshot: transcriptBufferRef.current.snapshot,
              translationSnapshot: translationSegmentManagerRef.current.snapshot,
            });
            return;
          }

          const translationSnapshot = translationSegmentManagerRef.current.failTranslation({
            segmentId: event.request.segmentId,
            revision: event.request.revision,
            message: event.message,
          });
          syncTranslationSnapshot(translationSnapshot);
        },
        onSuperseded: (event) => {
          if (event.request.jobKind === "bubble_finalize") {
            const existingTranslation =
              bubbleFinalTranslationsRef.current.get(event.request.segmentId) ?? null;

            if (existingTranslation?.status === "streaming") {
              bubbleFinalTranslationsRef.current.delete(event.request.segmentId);
              syncBubbleSnapshot({
                transcriptSnapshot: transcriptBufferRef.current.snapshot,
                translationSnapshot: translationSegmentManagerRef.current.snapshot,
              });
            }
            return;
          }

          const translationSnapshot = translationSegmentManagerRef.current.supersedeTranslation({
            segmentId: event.request.segmentId,
            revision: event.request.revision,
          });
          syncTranslationSnapshot(translationSnapshot);
        },
      },
      {
        maxConcurrentTasks: TRANSLATION_CORE_CONFIG.scheduler.maxConcurrentJobs,
      },
    );
  }, [markPerf, syncBubbleSnapshot, syncTranslationSnapshot]);

  useEffect(() => stop, [stop]);

  useEffect(() => {
    const markHidden = () => {
      backgroundHiddenSinceRef.current = Date.now();
      backgroundStopTriggeredRef.current = false;
      scheduleBackgroundStop();
    };

    const handleForegroundReturn = () => {
      clearBackgroundStopTimer();

      const shouldStop = maybeAutoStopForBackground({
        allowVisible: true,
      });

      backgroundHiddenSinceRef.current = null;

      if (!shouldStop) {
        backgroundStopTriggeredRef.current = false;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden" || document.hidden) {
        markHidden();
        return;
      }

      handleForegroundReturn();
    };

    const handlePageHide = () => {
      markHidden();
    };

    const handleFreeze = () => {
      markHidden();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);
    document.addEventListener("freeze", handleFreeze as EventListener);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
      document.removeEventListener("freeze", handleFreeze as EventListener);
      clearBackgroundStopTimer();
    };
  }, [clearBackgroundStopTimer, maybeAutoStopForBackground, scheduleBackgroundStop]);

  useEffect(() => {
    clearBubbleSealTimer();

    if (state.appStatus !== "listening") {
      return;
    }

    const activeBubble =
      state.bubbles.find((bubble) => bubble.bubbleId === state.activeBubbleId) ?? null;

    if (!activeBubble) {
      return;
    }

    if (activeBubble.status === "closed") {
      return;
    }

    const sealDeadline = getBubbleSealDeadline(activeBubble, bubbleSealAfterMs);

    if (sealDeadline === null) {
      return;
    }

    const refreshInMs = Math.max(0, sealDeadline - Date.now());

    bubbleSealTimerRef.current = window.setTimeout(() => {
      syncBubbleSnapshot({
        transcriptSnapshot: transcriptBufferRef.current.snapshot,
        translationSnapshot: translationSegmentManagerRef.current.snapshot,
        nowMs: Date.now(),
      });
    }, refreshInMs);

    return clearBubbleSealTimer;
  }, [
    bubbleSealAfterMs,
    clearBubbleSealTimer,
    state.activeBubbleId,
    state.appStatus,
    state.bubbles,
    syncBubbleSnapshot,
  ]);

  useEffect(() => {
    if (state.appStatus !== "listening") {
      return;
    }

    const intervalId = window.setInterval(() => {
      const transcriptSnapshot = transcriptBufferRef.current.snapshot;
      const suggestions = stabilizerRef.current
        .evaluate(transcriptSnapshot)
        .filter((suggestion) => suggestion.reason === "stabilized");

      for (const suggestion of suggestions) {
        void handleSuggestion(transcriptSnapshot, suggestion);
      }
    }, stabilizerRef.current.config.pollIntervalMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [handleSuggestion, state.appStatus]);

  return {
    state,
    start,
    stop,
    clearError: () => dispatch({ type: "clear_error" }),
    clearTranscript: () => {
      resetTranscriptSession();
      resetTranslationSession();
      dispatch({ type: "clear_error" });
    },
  };
}
