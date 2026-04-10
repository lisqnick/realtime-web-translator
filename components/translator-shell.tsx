"use client";

import { useState, useSyncExternalStore } from "react";

import { getRelativePerfDurations } from "@/lib/perf/transcript-metrics";
import {
  getLanguageConfig,
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

const connectionStatusLabel = {
  disconnected: "未连接",
  creating_session: "创建会话中",
  connecting: "连接中",
  connected: "已连接",
  error: "连接错误",
} as const;

const micStatusLabel = {
  not_requested: "麦克风未请求",
  prompt: "等待麦克风授权",
  granted: "麦克风已授权",
  denied: "麦克风被拒绝",
  unsupported: "麦克风不支持",
  error: "麦克风异常",
} as const;

const bubbleStatusLabel = {
  live: "实时",
  stable: "稳定",
  closed: "已收起",
} as const;

function formatTimelineTimestamp(timestamp: number) {
  const date = new Date(timestamp);
  const timeLabel = date.toLocaleTimeString("ja-JP", {
    hour12: false,
  });

  return `${timeLabel}.${date.getMilliseconds().toString().padStart(3, "0")}`;
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
  const sourceLanguage = getLanguageConfig(currentDirection.sourceLanguage)!;
  const targetLanguage = getLanguageConfig(currentDirection.targetLanguage)!;
  const currentScenario = getScenarioById(scenarioId)!;
  const showDebugPanel = runtimeDefaults.nodeEnv === "development";
  const { state, start, stop, clearError, clearTranscript } = useRealtimeController({
    sourceLanguage: currentDirection.sourceLanguage,
    targetLanguage: currentDirection.targetLanguage,
    scenario: scenarioId,
    debugPerfLogs: runtimeDefaults.debugPerfLogs,
  });

  const isStarting =
    state.appStatus === "requesting_mic" ||
    state.appStatus === "creating_session" ||
    state.appStatus === "connecting_realtime";
  const controlsLocked =
    isStarting || state.appStatus === "listening" || state.appStatus === "stopping";
  const canStart = !isStarting && state.appStatus !== "listening" && state.appStatus !== "stopping";
  const canStop =
    isStarting || state.appStatus === "listening" || state.appStatus === "stopping";
  const canClear =
    Boolean(state.errorMessage) ||
    Boolean(state.translationErrorMessage) ||
    state.liveSourceText.length > 0 ||
    state.liveTranslationText.length > 0 ||
    state.bubbles.length > 0 ||
    state.translatedSegments.some(
      (segment) =>
        segment.translatedText.length > 0 ||
        segment.liveTranslatedText.length > 0 ||
        segment.errorMessage !== null,
    );

  const perfSummary = getRelativePerfDurations(state.perfSnapshot);
  const compactStatus = `${connectionStatusLabel[state.connectionStatus]} · ${
    micStatusLabel[state.micPermissionStatus]
  }`;
  const browserUnsupported = secureContext === "no" || getUserMediaType !== "function";

  return (
    <section className={styles.shell}>
      <div className={styles.phoneFrame}>
        <header className={styles.header}>
          <div className={styles.headerTop}>
            <div>
              <p className={styles.eyebrow}>实时口语翻译</p>
              <h1 className={styles.title}>中日双向翻译</h1>
            </div>
            <div className={styles.statusPill}>{compactStatus}</div>
          </div>

          <div className={styles.languageBar}>
            <div className={styles.languageChip}>
              <span>源语言</span>
              <strong>{sourceLanguage.label}</strong>
            </div>
            <button
              type="button"
              className={styles.swapButton}
              disabled={controlsLocked}
              onClick={() =>
                setDirectionId((currentValue) =>
                  currentValue === "zh-CN__ja-JP" ? "ja-JP__zh-CN" : "zh-CN__ja-JP",
                )
              }
              aria-label="交换语言方向"
            >
              ⇄
            </button>
            <div className={styles.languageChip}>
              <span>目标语言</span>
              <strong>{targetLanguage.label}</strong>
            </div>
          </div>

          <div className={styles.headerMeta}>
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
            <p className={styles.scenarioHint}>{currentScenario.description}</p>
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
          {state.bubbles.length === 0 ? (
            <div className={styles.emptyState}>
              <p className={styles.emptyTitle}>开始后，这里会像手机翻译工具一样按消息流显示内容。</p>
              <p>
                你连续说几句短句时，多个 chunk 会先聚合进同一个对话框；同一张卡里的原文和译文会持续补全，停顿更久或累积过长时再开下一张卡。
              </p>
            </div>
          ) : null}

          {state.bubbles.map((bubble) => (
            <article
              key={bubble.bubbleId}
              className={`${styles.messageCard} ${
                bubble.status === "live" ? styles.liveMessageCard : ""
              }`}
            >
              <div className={styles.cardMeta}>
                <span>{bubbleStatusLabel[bubble.status]}</span>
                <span>{bubble.bubbleId}</span>
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
                    {bubble.isTranslating
                      ? `翻译中 · ${bubble.chunkCount} chunks · 修正 ${bubble.correctionCount}`
                      : `${bubbleStatusLabel[bubble.status]} · ${bubble.chunkCount} chunks`}
                  </span>
                </div>
                <p className={styles.translationText}>
                  {bubble.mergedTranslationText ||
                    "这张卡里的译文正在补全。等当前 chunk 趋于稳定后，下面会继续接上新的译文。"}
                </p>
                {bubble.errorMessage ? (
                  <p className={styles.inlineError}>{bubble.errorMessage}</p>
                ) : null}
              </div>
            </article>
          ))}
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
            </div>
          </details>
        ) : null}

        <footer className={styles.toolbar}>
          <button
            type="button"
            className={styles.primaryButton}
            disabled={!canStart}
            onClick={start}
          >
            {state.appStatus === "listening"
              ? "监听中"
              : isStarting
                ? "连接中..."
                : "开始"}
          </button>
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={!canStop}
            onClick={stop}
          >
            停止
          </button>
          <button
            type="button"
            className={styles.ghostButton}
            disabled={!canClear}
            onClick={() => {
              clearError();
              clearTranscript();
            }}
          >
            清空
          </button>
        </footer>
      </div>
    </section>
  );
}
