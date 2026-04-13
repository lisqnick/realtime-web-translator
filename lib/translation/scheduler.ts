import { TRANSLATION_CORE_CONFIG } from "@/config/translation-core";
import { streamTranslationJob } from "@/lib/translation-core/translator";
import { isSegmentFirstPassJob } from "@/lib/translation-core/translation-jobs";
import { TranslationClientError } from "@/lib/translation/api";
import type {
  TranslationScheduleRequest,
  TranslationTaskSummary,
} from "@/types/translation";

interface TranslationSchedulerConfig {
  maxConcurrentTasks: number;
  retryAttempts: number;
}

interface ActiveTranslationTask {
  request: TranslationScheduleRequest;
  controller: AbortController;
  attempt: number;
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
    request: TranslationScheduleRequest;
    delta: string;
    text: string;
  }) => void;
  onCompleted?: (input: {
    request: TranslationScheduleRequest;
    text: string;
    sourceText: string;
  }) => void;
  onError?: (input: {
    request: TranslationScheduleRequest;
    message: string;
  }) => void;
  onSuperseded?: (input: {
    request: TranslationScheduleRequest;
  }) => void;
}

export interface TranslationScheduler {
  snapshot: TranslationSchedulerSnapshot;
  scheduleTranslation: (request: TranslationScheduleRequest) => Promise<boolean>;
  reset: () => void;
}

const DEFAULT_SCHEDULER_CONFIG: TranslationSchedulerConfig = {
  maxConcurrentTasks: TRANSLATION_CORE_CONFIG.scheduler.maxConcurrentJobs,
  retryAttempts: 1,
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
      jobKind: task.request.jobKind,
      jobId: task.request.jobId,
      segmentId: task.request.segmentId,
      revision: task.request.revision,
      reason: task.request.reason,
      status: "streaming",
    })),
    queuedTasks: queuedRequests.map((request) => ({
      jobKind: request.jobKind,
      jobId: request.jobId,
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
        if (isSegmentFirstPassJob(request)) {
          const desiredRevision = desiredRevisionBySegment.get(request.segmentId) ?? 0;

          return desiredRevision === request.revision && !activeTasks.has(request.jobId);
        }

        return !activeTasks.has(request.jobId);
      });

      if (nextIndex === -1) {
        break;
      }

      const [nextRequest] = queuedRequests.splice(nextIndex, 1);
      emitSnapshot();
      void startTask(nextRequest);
    }
  };

  const startTask = async (
    request: TranslationScheduleRequest,
    attempt = 0,
  ) => {
    const controller = new AbortController();
    activeTasks.set(request.jobId, {
      request,
      controller,
      attempt,
    });
    emitSnapshot();
    callbacks.onRequestStarted?.(request);

    try {
      await streamTranslationJob({
        request,
        signal: controller.signal,
        onEvent: (event) => {
          if (event.revision !== request.revision) {
            return;
          }

          if (
            isSegmentFirstPassJob(request) &&
            (desiredRevisionBySegment.get(request.segmentId) ?? 0) !== request.revision
          ) {
            return;
          }

          if (event.type === "translation.started") {
            return;
          }

          if (event.type === "translation.delta") {
            callbacks.onDelta?.({
              request,
              delta: event.delta,
              text: event.text,
            });
            return;
          }

          if (event.type === "translation.completed") {
            completedRequestKeys.add(buildRequestKey(request));
            callbacks.onCompleted?.({
              request,
              text: event.text,
              sourceText: request.sourceText,
            });
            return;
          }

          callbacks.onError?.({
            request,
            message: event.message,
          });
        },
      });
    } catch (error) {
      if (controller.signal.aborted) {
        callbacks.onSuperseded?.({
          request,
        });
      } else if (attempt < resolvedConfig.retryAttempts) {
        queuedRequests.unshift(request);
      } else {
        const message =
          error instanceof TranslationClientError
            ? error.message
            : error instanceof Error
              ? error.message
              : `翻译任务 ${request.jobId} 失败。`;

        callbacks.onError?.({
          request,
          message,
        });
      }
    } finally {
      activeTasks.delete(request.jobId);
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

      if (completedRequestKeys.has(requestKey)) {
        return false;
      }

      if (isSegmentFirstPassJob(request)) {
        const desiredRevision = desiredRevisionBySegment.get(request.segmentId) ?? 0;

        if (desiredRevision > request.revision) {
          return false;
        }

        if (desiredRevision === request.revision) {
          if (
            queuedRequests.some((queuedRequest) => queuedRequest.jobId === request.jobId)
          ) {
            return false;
          }

          if (activeTasks.has(request.jobId)) {
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
            isSegmentFirstPassJob(queuedRequest) &&
            queuedRequest.segmentId === request.segmentId &&
            queuedRequest.revision < request.revision
          ) {
            queuedRequests.splice(queueIndex, 1);
          }
        }

        for (const task of activeTasks.values()) {
          if (
            isSegmentFirstPassJob(task.request) &&
            task.request.segmentId === request.segmentId &&
            task.request.revision < request.revision
          ) {
            task.controller.abort();
          }
        }
      } else {
        if (
          queuedRequests.some((queuedRequest) => queuedRequest.jobId === request.jobId) ||
          activeTasks.has(request.jobId)
        ) {
          return false;
        }
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
  return `${request.jobKind}:${request.jobId}:${request.revision}`;
}
