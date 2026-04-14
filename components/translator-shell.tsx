"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { getRelativePerfDurations } from "@/lib/perf/transcript-metrics";
import {
  getNextUiDirectionId,
  getUiDirectionById,
} from "@/lib/languages/config";
import { useRealtimeController } from "@/lib/realtime/use-realtime-controller";
import { getScenarioById, scenarioCatalog } from "@/lib/scenarios/config";
import type {
  PublicRuntimeDefaults,
  ScenarioId,
  UiLanguageDirectionId,
} from "@/types/config";

import styles from "./translator-shell.module.css";

interface TranslatorShellProps {
  runtimeDefaults: PublicRuntimeDefaults;
}

const bubbleStatusLabel = {
  live: "实时",
  stable: "稳定",
  closed: "已收起",
} as const;

const AUTO_SCROLL_BOTTOM_GAP_PX = 108;
const AUTO_SCROLL_THRESHOLD_PX = 180;
const PROGRAMMATIC_SCROLL_RELEASE_MS = 140;

function getViewportHeight() {
  if (typeof window === "undefined") {
    return 0;
  }

  return window.visualViewport?.height ?? window.innerHeight;
}

function getDistanceFromBottom(feedEnd: HTMLDivElement | null) {
  if (!feedEnd) {
    return Number.POSITIVE_INFINITY;
  }

  return feedEnd.getBoundingClientRect().bottom - getViewportHeight();
}

function formatTimelineTimestamp(timestamp: number) {
  const date = new Date(timestamp);
  const timeLabel = date.toLocaleTimeString("ja-JP", {
    hour12: false,
  });

  return `${timeLabel}.${date.getMilliseconds().toString().padStart(3, "0")}`;
}

function formatDebugTimestamp(timestamp: number | null) {
  if (timestamp === null) {
    return "-";
  }

  return formatTimelineTimestamp(timestamp);
}

function getControlDotState(appStatus: string) {
  if (appStatus === "listening" || appStatus === "stopping") {
    return "danger" as const;
  }

  if (
    appStatus === "requesting_mic" ||
    appStatus === "creating_session" ||
    appStatus === "connecting_realtime"
  ) {
    return "info" as const;
  }

  return "success" as const;
}

export function TranslatorShell({ runtimeDefaults }: TranslatorShellProps) {
  const [directionId, setDirectionId] = useState<UiLanguageDirectionId>(
    runtimeDefaults.defaultDirectionId,
  );
  const [scenarioId, setScenarioId] = useState<ScenarioId>(
    runtimeDefaults.defaultScenarioId,
  );
  const secureContext = useSyncExternalStore(
    () => () => undefined,
    () => (window.isSecureContext ? "yes" : "no"),
    () => "loading",
  );
  const getUserMediaType = useSyncExternalStore(
    () => () => undefined,
    () => typeof navigator.mediaDevices?.getUserMedia,
    () => "loading",
  );
  const hostname = useSyncExternalStore(
    () => () => undefined,
    () => window.location.hostname,
    () => "loading",
  );
  const protocol = useSyncExternalStore(
    () => () => undefined,
    () => window.location.protocol,
    () => "loading",
  );

  const currentDirection = getUiDirectionById(directionId)!;
  const showDebugPanel = runtimeDefaults.nodeEnv === "development";
  const { state, start, stop } = useRealtimeController({
    directionMode: currentDirection.mode,
    sourceLanguage: currentDirection.sourceLanguage,
    targetLanguage: currentDirection.targetLanguage,
    scenario: scenarioId,
    debugPerfLogs: runtimeDefaults.debugPerfLogs,
  });
  const feedEndRef = useRef<HTMLDivElement | null>(null);
  const autoScrollEnabledRef = useRef(true);
  const isProgrammaticScrollRef = useRef(false);
  const programmaticScrollReleaseTimerRef = useRef<number | null>(null);

  const isStarting =
    state.appStatus === "requesting_mic" ||
    state.appStatus === "creating_session" ||
    state.appStatus === "connecting_realtime";
  const controlsLocked =
    isStarting || state.appStatus === "listening" || state.appStatus === "stopping";
  const canStart = !isStarting && state.appStatus !== "listening" && state.appStatus !== "stopping";
  const controlDotTone = getControlDotState(state.appStatus);
  const controlDotDisabled =
    state.appStatus === "requesting_mic" ||
    state.appStatus === "creating_session" ||
    state.appStatus === "connecting_realtime" ||
    state.appStatus === "stopping";
  const controlDotAction =
    state.appStatus === "listening" ? stop : canStart ? start : undefined;
  const controlDotLabel =
    state.appStatus === "listening"
      ? "停止翻译"
      : state.appStatus === "stopping"
        ? "停止中"
        : state.appStatus === "requesting_mic"
          ? "正在请求麦克风权限"
          : state.appStatus === "creating_session"
            ? "正在创建会话"
            : state.appStatus === "connecting_realtime"
              ? "正在连接"
              : "开始翻译";

  const perfSummary = getRelativePerfDurations(state.perfSnapshot);
  const browserUnsupported =
    secureContext !== "loading" &&
    getUserMediaType !== "loading" &&
    (secureContext === "no" || getUserMediaType !== "function");
  const feedSignature = useMemo(() => {
    const latestBubble = state.bubbles.at(-1) ?? null;

    return [
      state.bubbles.length,
      latestBubble?.bubbleId ?? "-",
      latestBubble?.mergedSourceText.length ?? 0,
      latestBubble?.mergedTranslationText.length ?? 0,
      latestBubble?.status ?? "-",
      latestBubble?.finalTranslationStatus ?? "-",
    ].join(":");
  }, [state.bubbles]);

  useEffect(() => {
    const clearProgrammaticScrollReleaseTimer = () => {
      if (programmaticScrollReleaseTimerRef.current !== null) {
        window.clearTimeout(programmaticScrollReleaseTimerRef.current);
        programmaticScrollReleaseTimerRef.current = null;
      }
    };

    const updateAutoScrollState = () => {
      if (isProgrammaticScrollRef.current) {
        return;
      }

      autoScrollEnabledRef.current =
        getDistanceFromBottom(feedEndRef.current) <= AUTO_SCROLL_THRESHOLD_PX;
    };

    const visualViewport = window.visualViewport;

    updateAutoScrollState();
    window.addEventListener("scroll", updateAutoScrollState, { passive: true });
    window.addEventListener("resize", updateAutoScrollState);
    visualViewport?.addEventListener("resize", updateAutoScrollState);
    visualViewport?.addEventListener("scroll", updateAutoScrollState);

    return () => {
      clearProgrammaticScrollReleaseTimer();
      window.removeEventListener("scroll", updateAutoScrollState);
      window.removeEventListener("resize", updateAutoScrollState);
      visualViewport?.removeEventListener("resize", updateAutoScrollState);
      visualViewport?.removeEventListener("scroll", updateAutoScrollState);
    };
  }, []);

  useEffect(() => {
    if (!autoScrollEnabledRef.current || state.bubbles.length === 0) {
      return;
    }

    window.requestAnimationFrame(() => {
      const feedEnd = feedEndRef.current;
      if (!feedEnd) {
        return;
      }

      const targetScrollY =
        window.scrollY +
        feedEnd.getBoundingClientRect().bottom -
        (getViewportHeight() - AUTO_SCROLL_BOTTOM_GAP_PX);

      if (programmaticScrollReleaseTimerRef.current !== null) {
        window.clearTimeout(programmaticScrollReleaseTimerRef.current);
        programmaticScrollReleaseTimerRef.current = null;
      }

      isProgrammaticScrollRef.current = true;
      window.scrollTo({
        top: Math.max(0, targetScrollY),
        behavior: "auto",
      });

      window.requestAnimationFrame(() => {
        programmaticScrollReleaseTimerRef.current = window.setTimeout(() => {
          isProgrammaticScrollRef.current = false;
          programmaticScrollReleaseTimerRef.current = null;
        }, PROGRAMMATIC_SCROLL_RELEASE_MS);
      });
    });
  }, [feedSignature, state.bubbles.length]);

  return (
    <section className={styles.shell}>
      <div className={styles.phoneFrame}>
        <h1 className="visually-hidden">实时中日互译工具</h1>
        <header className={styles.header}>
          <div className={styles.languageBar}>
            <div className={styles.languageChip}>
              <span>源语言</span>
              <strong>{currentDirection.sourceLabel}</strong>
            </div>
            <button
              type="button"
              className={styles.swapButton}
              disabled={controlsLocked}
              onClick={() =>
                setDirectionId((currentValue) => getNextUiDirectionId(currentValue))
              }
              aria-label="切换翻译方向模式"
              title="切换翻译方向模式"
            >
              ⇄
            </button>
            <div className={styles.languageChip}>
              <span>目标语言</span>
              <strong>{currentDirection.targetLabel}</strong>
            </div>
          </div>

          <div className={styles.headerMetaCompact}>
            <label className={styles.scenarioField}>
              <span>场景</span>
              <select
                value={scenarioId}
                disabled={controlsLocked}
                onChange={(event) => setScenarioId(event.target.value as ScenarioId)}
              >
                {scenarioCatalog.filter((scenario) => scenario.enabled).map((scenario) => (
                  <option key={scenario.id} value={scenario.id}>
                    {scenario.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </header>

        {state.errorMessage ? (
          <div className={styles.errorBanner}>
            <strong>当前错误</strong>
            <p>{state.errorMessage}</p>
          </div>
        ) : null}

        {state.translationErrorMessage ? (
          <div className={styles.errorBanner}>
            <strong>最近一次翻译错误</strong>
            <p>{state.translationErrorMessage}</p>
          </div>
        ) : null}

        {browserUnsupported ? (
          <div className={styles.errorBanner}>
            <strong>麦克风当前不可用</strong>
            <p>当前页面不是安全上下文，或浏览器环境不支持麦克风采集。</p>
          </div>
        ) : null}

        {state.micAccessErrorName || state.micAccessErrorMessage ? (
          <div className={styles.errorBanner}>
            <strong>getUserMedia 原始错误</strong>
            <p>name: {state.micAccessErrorName ?? "-"}</p>
            <p>message: {state.micAccessErrorMessage ?? "-"}</p>
          </div>
        ) : null}

        <main className={styles.feed}>
          {state.bubbles.map((bubble) => (
            <article
              key={bubble.bubbleId}
              className={`${styles.messageCard} ${
                bubble.status === "live" ? styles.liveMessageCard : ""
              }`}
            >
              <div className={styles.cardMeta}>
                <span>
                  {bubble.finalTranslationStatus === "streaming"
                    ? "正在整理最终译文"
                    : bubble.isTranslating
                      ? "翻译中"
                      : bubbleStatusLabel[bubble.status]}
                </span>
                <span>{getScenarioById(bubble.scenario)?.label ?? "通用"}</span>
              </div>
              <div className={styles.sourceBlock}>
                <p className={styles.blockLabel}>原文</p>
                <p className={styles.sourceText}>
                  {bubble.mergedSourceText || "正在等待这张卡里的原文内容..."}
                </p>
              </div>
              <div className={styles.translationBlock}>
                <div className={styles.blockHeader}>
                  <p className={styles.blockLabel}>译文</p>
                  <span className={styles.blockState}>
                    {bubble.finalTranslationStatus === "streaming"
                      ? `正在整理最终译文 · ${bubble.chunkCount} 段`
                      : bubble.isTranslating
                        ? `翻译中 · ${bubble.chunkCount} 段`
                        : `${bubbleStatusLabel[bubble.status]} · ${bubble.chunkCount} 段`}
                  </span>
                </div>
                <p className={styles.translationText}>
                  {bubble.mergedTranslationText ||
                    "…"}
                </p>
                {bubble.errorMessage ? (
                  <p className={styles.inlineError}>{bubble.errorMessage}</p>
                ) : null}
              </div>
            </article>
          ))}
          <div ref={feedEndRef} className={styles.feedEnd} />
        </main>

        {showDebugPanel ? (
          <details className={styles.debugDetails}>
            <summary>开发调试</summary>
            <div className={styles.debugContent}>
              <dl className={styles.debugList}>
                <div>
                  <dt>App Status</dt>
                  <dd>{state.appStatus}</dd>
                </div>
                <div>
                  <dt>Connection</dt>
                  <dd>{state.connectionStatus}</dd>
                </div>
                <div>
                  <dt>Mic Permission</dt>
                  <dd>{state.micPermissionStatus}</dd>
                </div>
                <div>
                  <dt>Secure Context</dt>
                  <dd>{secureContext}</dd>
                </div>
                <div>
                  <dt>getUserMedia Type</dt>
                  <dd>{getUserMediaType}</dd>
                </div>
                <div>
                  <dt>Hostname</dt>
                  <dd>{hostname}</dd>
                </div>
                <div>
                  <dt>Protocol</dt>
                  <dd>{protocol}</dd>
                </div>
                <div>
                  <dt>Realtime Model</dt>
                  <dd>
                    {state.sessionModel ??
                      process.env.NEXT_PUBLIC_REALTIME_MODEL_HINT ??
                      "server-managed"}
                  </dd>
                </div>
                <div>
                  <dt>Turn Detection</dt>
                  <dd>
                    {state.sessionTurnDetectionType
                      ? `${state.sessionTurnDetectionType} / silence ${state.sessionSilenceDurationMs ?? "-"}ms`
                      : "-"}
                  </dd>
                </div>
                <div>
                  <dt>Session ID</dt>
                  <dd>{state.sessionId ?? "-"}</dd>
                </div>
                <div>
                  <dt>Last Event</dt>
                  <dd>{state.lastRealtimeEventType ?? "-"}</dd>
                </div>
                <div>
                  <dt>Active Bubble</dt>
                  <dd>{state.activeBubbleId ?? "-"}</dd>
                </div>
                <div>
                  <dt>Bubble Count</dt>
                  <dd>
                    {state.bubbles.length}
                  </dd>
                </div>
                <div>
                  <dt>Bubble Chunks</dt>
                  <dd>{state.bubbleDebug.activeBubbleChunkCount || "-"}</dd>
                </div>
                <div>
                  <dt>Last Chunk Gap</dt>
                  <dd>
                    {state.bubbleDebug.lastChunkGapMs === null
                      ? "-"
                      : `${state.bubbleDebug.lastChunkGapMs}ms`}
                  </dd>
                </div>
                <div>
                  <dt>Gap Basis</dt>
                  <dd>{state.bubbleDebug.lastChunkGapBasis ?? "-"}</dd>
                </div>
                <div>
                  <dt>Bubble Open Reason</dt>
                  <dd>{state.bubbleDebug.lastOpenReason ?? "-"}</dd>
                </div>
                <div>
                  <dt>Bubble Translating</dt>
                  <dd>{state.bubbleDebug.activeBubbleIsTranslating ? "yes" : "no"}</dd>
                </div>
                <div>
                  <dt>Bubble Corrections</dt>
                  <dd>{state.bubbleDebug.activeBubbleCorrectionCount}</dd>
                </div>
                <div>
                  <dt>Active Tasks</dt>
                  <dd>
                    {state.activeTranslationTasks.length > 0
                      ? state.activeTranslationTasks
                          .map(
                            (task) =>
                              `${task.segmentId}@r${task.revision}(${task.reason}/${task.status})`,
                          )
                          .join(", ")
                      : "-"}
                  </dd>
                </div>
                <div>
                  <dt>firstPartialTranscriptAt</dt>
                  <dd>
                    {perfSummary.timeToFirstPartialTranscriptMs === null
                      ? "-"
                      : `${perfSummary.timeToFirstPartialTranscriptMs}ms`}
                  </dd>
                </div>
                <div>
                  <dt>firstFinalTranscriptAt</dt>
                  <dd>
                    {perfSummary.timeToFirstFinalTranscriptMs === null
                      ? "-"
                      : `${perfSummary.timeToFirstFinalTranscriptMs}ms`}
                  </dd>
                </div>
                <div>
                  <dt>firstStableTriggerAt</dt>
                  <dd>
                    {perfSummary.timeToFirstStableTriggerMs === null
                      ? "-"
                      : `${perfSummary.timeToFirstStableTriggerMs}ms`}
                  </dd>
                </div>
                <div>
                  <dt>firstTranslationRequestAt</dt>
                  <dd>
                    {perfSummary.timeToFirstTranslationRequestMs === null
                      ? "-"
                      : `${perfSummary.timeToFirstTranslationRequestMs}ms`}
                  </dd>
                </div>
                <div>
                  <dt>firstTranslationDeltaAt</dt>
                  <dd>
                    {perfSummary.timeToFirstTranslationDeltaMs === null
                      ? "-"
                      : `${perfSummary.timeToFirstTranslationDeltaMs}ms`}
                  </dd>
                </div>
                <div>
                  <dt>firstTranslationCompleteAt</dt>
                  <dd>
                    {perfSummary.timeToFirstTranslationCompleteMs === null
                      ? "-"
                      : `${perfSummary.timeToFirstTranslationCompleteMs}ms`}
                  </dd>
                </div>
              </dl>

              <div className={styles.timelinePanel}>
                <p className={styles.timelineTitle}>最近一次说话事件时间线</p>
                {state.realtimeEventTimeline.length > 0 ? (
                  <ol className={styles.timelineList}>
                    {state.realtimeEventTimeline.map((entry, index) => (
                      <li
                        key={`${entry.eventType}-${entry.arrivedAt}-${index}`}
                        className={styles.timelineItem}
                      >
                        <code>{entry.eventType}</code>
                        <span>{formatTimelineTimestamp(entry.arrivedAt)}</span>
                        <span>
                          {entry.elapsedMsFromMicStart === null
                            ? "mic +n/a"
                            : `mic +${entry.elapsedMsFromMicStart}ms`}
                        </span>
                        <span>item {entry.itemId ?? "-"}</span>
                        <span>
                          index {entry.contentIndex === null ? "-" : entry.contentIndex}
                        </span>
                        <span>
                          len {entry.textLength === null ? "-" : entry.textLength}
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className={styles.timelineEmpty}>
                    还没有捕获到本轮说话的关键事件。点击开始后连续说 3 到 5 秒，再展开这里查看顺序。
                  </p>
                )}
              </div>

              <div className={styles.timelinePanel}>
                <p className={styles.timelineTitle}>最近若干条 bubble 判定</p>
                {state.bubbleDebug.recentDecisions.length > 0 ? (
                  <ol className={styles.timelineList}>
                    {state.bubbleDebug.recentDecisions.map((entry, index) => (
                      <li
                        key={`${entry.segmentId}-${entry.createdAt}-${index}`}
                        className={styles.timelineItem}
                      >
                        <code>{entry.segmentId}</code>
                        <span>{entry.decision}</span>
                        <span>{entry.reason}</span>
                        <span>
                          gap {entry.computedGapMs === null ? "-" : `${entry.computedGapMs}ms`}
                        </span>
                        <span>{entry.gapComputedFrom ?? "-"}</span>
                        <span>prev {entry.previousChunkId ?? "-"}</span>
                        <span>
                          active {entry.currentActiveBubbleId ?? "-"} /{" "}
                          {entry.currentActiveBubbleChunkCount}
                        </span>
                        <span>created {formatDebugTimestamp(entry.createdAt)}</span>
                        <span>final {formatDebugTimestamp(entry.finalizedAt)}</span>
                        <span>commit {formatDebugTimestamp(entry.committedAt)}</span>
                        <span>speech start {formatDebugTimestamp(entry.speechStartedAt)}</span>
                        <span>speech stop {formatDebugTimestamp(entry.speechStoppedAt)}</span>
                        <span className={styles.timelineText}>{entry.sourceText || "-"}</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className={styles.timelineEmpty}>
                    还没有生成 bubble 判定日志。先连续说几句短句，再回来看每个 chunk 是 append 还是 create。
                  </p>
                )}
              </div>
            </div>
          </details>
        ) : null}
      </div>

      <div className={styles.controlDotDock}>
        <button
          type="button"
          className={`${styles.controlDot} ${styles[`controlDot--${controlDotTone}`]} ${
            controlDotDisabled ? styles["controlDot--disabled"] : ""
          }`}
          disabled={controlDotDisabled}
          onClick={controlDotAction}
          aria-label={controlDotLabel}
        >
          <span className="visually-hidden">{controlDotLabel}</span>
          <span className={styles.controlDotCore} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
