import { streamSegmentTranslation, TranslationClientError } from "@/lib/translation/api";
import type {
  TranslationScheduleRequest,
  TranslationTaskSummary,
} from "@/types/translation";

interface TranslationSchedulerConfig {
  maxConcurrentTasks: number;
}

interface ActiveTranslationTask {
  request: TranslationScheduleRequest;
  controller: AbortController;
}

export interface TranslationSchedulerSnapshot {
  activeTasks: TranslationTaskSummary[];
  queuedTasks: TranslationTaskSummary[];
  recentRevisionCount: number;
}

export interface TranslationSchedulerCallbacks {
  onSnapshot?: (snapshot: TranslationSchedulerSnapshot) => void;
  onRequestStarted?: (request: TranslationScheduleRequest) => void;
  onDelta?: (input: {
    segmentId: string;
    revision: number;
    delta: string;
    text: string;
    reason: TranslationScheduleRequest["reason"];
  }) => void;
  onCompleted?: (input: {
    segmentId: string;
    revision: number;
    text: string;
    sourceText: string;
    reason: TranslationScheduleRequest["reason"];
  }) => void;
  onError?: (input: {
    segmentId: string;
    revision: number;
    message: string;
    reason: TranslationScheduleRequest["reason"];
  }) => void;
  onSuperseded?: (input: {
    segmentId: string;
    revision: number;
    reason: TranslationScheduleRequest["reason"];
  }) => void;
}

export interface TranslationScheduler {
  snapshot: TranslationSchedulerSnapshot;
  scheduleTranslation: (request: TranslationScheduleRequest) => Promise<boolean>;
  reset: () => void;
}

const DEFAULT_SCHEDULER_CONFIG: TranslationSchedulerConfig = {
  maxConcurrentTasks: 2,
};

export function createTranslationScheduler(
  callbacks: TranslationSchedulerCallbacks,
  config?: Partial<TranslationSchedulerConfig>,
): TranslationScheduler {
  const resolvedConfig = {
    ...DEFAULT_SCHEDULER_CONFIG,
    ...config,
  };
  const queuedRequests: TranslationScheduleRequest[] = [];
  const activeTasks = new Map<string, ActiveTranslationTask>();
  const completedRequestKeys = new Set<string>();
  const desiredRevisionBySegment = new Map<string, number>();
  let recentRevisionCount = 0;

  const getSnapshot = (): TranslationSchedulerSnapshot => ({
    activeTasks: [...activeTasks.values()].map((task) => ({
      segmentId: task.request.segmentId,
      revision: task.request.revision,
      reason: task.request.reason,
      status: "streaming",
    })),
    queuedTasks: queuedRequests.map((request) => ({
      segmentId: request.segmentId,
      revision: request.revision,
      reason: request.reason,
      status: "queued",
    })),
    recentRevisionCount,
  });

  const emitSnapshot = () => {
    callbacks.onSnapshot?.(getSnapshot());
  };

  const processQueue = async () => {
    while (
      activeTasks.size < resolvedConfig.maxConcurrentTasks &&
      queuedRequests.length > 0
    ) {
      const nextIndex = queuedRequests.findIndex((request) => {
        const desiredRevision = desiredRevisionBySegment.get(request.segmentId) ?? 0;

        return desiredRevision === request.revision && !activeTasks.has(request.segmentId);
      });

      if (nextIndex === -1) {
        break;
      }

      const [nextRequest] = queuedRequests.splice(nextIndex, 1);
      emitSnapshot();
      void startTask(nextRequest);
    }
  };

  const startTask = async (request: TranslationScheduleRequest) => {
    const controller = new AbortController();
    activeTasks.set(request.segmentId, {
      request,
      controller,
    });
    emitSnapshot();
    callbacks.onRequestStarted?.(request);

    try {
      await streamSegmentTranslation({
        request: {
          directionMode: request.directionMode,
          sourceLanguage: request.sourceLanguage,
          targetLanguage: request.targetLanguage,
          text: request.sourceText,
          previousContext: request.previousContext ?? null,
          segmentId: request.segmentId,
          revision: request.revision,
          isFinal: request.isFinal,
          scenario: request.scenario,
          triggerReason: request.reason,
        },
        signal: controller.signal,
        onEvent: (event) => {
          const desiredRevision = desiredRevisionBySegment.get(request.segmentId) ?? 0;

          if (event.revision !== request.revision || desiredRevision !== request.revision) {
            return;
          }

          if (event.type === "translation.started") {
            return;
          }

          if (event.type === "translation.delta") {
            callbacks.onDelta?.({
              segmentId: event.segmentId,
              revision: event.revision,
              delta: event.delta,
              text: event.text,
              reason: request.reason,
            });
            return;
          }

          if (event.type === "translation.completed") {
            completedRequestKeys.add(buildRequestKey(request));
            callbacks.onCompleted?.({
              segmentId: event.segmentId,
              revision: event.revision,
              text: event.text,
              sourceText: request.sourceText,
              reason: request.reason,
            });
            return;
          }

          callbacks.onError?.({
            segmentId: event.segmentId,
            revision: event.revision,
            message: event.message,
            reason: request.reason,
          });
        },
      });
    } catch (error) {
      if (controller.signal.aborted) {
        callbacks.onSuperseded?.({
          segmentId: request.segmentId,
          revision: request.revision,
          reason: request.reason,
        });
      } else {
        const message =
          error instanceof TranslationClientError
            ? error.message
            : error instanceof Error
              ? error.message
              : `片段 ${request.segmentId} 的翻译任务失败。`;

        callbacks.onError?.({
          segmentId: request.segmentId,
          revision: request.revision,
          message,
          reason: request.reason,
        });
      }
    } finally {
      activeTasks.delete(request.segmentId);
      emitSnapshot();
      void processQueue();
    }
  };

  return {
    get snapshot() {
      return getSnapshot();
    },
    async scheduleTranslation(request) {
      const requestKey = buildRequestKey(request);
      const desiredRevision = desiredRevisionBySegment.get(request.segmentId) ?? 0;

      if (completedRequestKeys.has(requestKey) || desiredRevision > request.revision) {
        return false;
      }

      if (desiredRevision === request.revision) {
        if (
          queuedRequests.some(
            (queuedRequest) =>
              queuedRequest.segmentId === request.segmentId &&
              queuedRequest.revision === request.revision,
          )
        ) {
          return false;
        }

        const activeTask = activeTasks.get(request.segmentId);

        if (activeTask?.request.revision === request.revision) {
          return false;
        }
      }

      if (request.revision > desiredRevision) {
        desiredRevisionBySegment.set(request.segmentId, request.revision);
        recentRevisionCount += desiredRevision > 0 ? 1 : 0;
      }

      for (let queueIndex = queuedRequests.length - 1; queueIndex >= 0; queueIndex -= 1) {
        const queuedRequest = queuedRequests[queueIndex];

        if (
          queuedRequest.segmentId === request.segmentId &&
          queuedRequest.revision < request.revision
        ) {
          queuedRequests.splice(queueIndex, 1);
        }
      }

      const activeTask = activeTasks.get(request.segmentId);

      if (activeTask && activeTask.request.revision < request.revision) {
        activeTask.controller.abort();
      }

      queuedRequests.push(request);
      emitSnapshot();
      await processQueue();
      return true;
    },
    reset() {
      for (const task of activeTasks.values()) {
        task.controller.abort();
      }

      activeTasks.clear();
      queuedRequests.length = 0;
      completedRequestKeys.clear();
      desiredRevisionBySegment.clear();
      recentRevisionCount = 0;
      emitSnapshot();
    },
  };
}

function buildRequestKey(request: TranslationScheduleRequest) {
  return `${request.segmentId}:${request.revision}`;
}
