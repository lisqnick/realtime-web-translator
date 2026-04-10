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

const translationStatusLabel = {
  idle: "待翻译",
  streaming: "翻译中",
  completed: "已完成",
  superseded: "已替换",
  failed: "失败",
} as const;

const sourceStatusLabel = {
  live: "实时",
  stable: "稳定",
  final: "定稿",
} as const;

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
    state.finalizedSegments.length > 0 ||
    state.translatedSegments.some(
      (segment) =>
        segment.translatedText.length > 0 ||
        segment.liveTranslatedText.length > 0 ||
        segment.errorMessage !== null,
    );

  const perfSummary = getRelativePerfDurations(state.perfSnapshot);
  const translationBySegmentId = new Map(
    state.translatedSegments.map((segment) => [segment.segmentId, segment]),
  );
  const finalizedSegmentIds = new Set(state.finalizedSegments.map((segment) => segment.segmentId));
  const translationInFlightSegment =
    state.liveTranslationSegmentId === null
      ? null
      : translationBySegmentId.get(state.liveTranslationSegmentId) ?? null;
  const liveSourcePreview =
    state.liveSourceText ||
    (translationInFlightSegment && !finalizedSegmentIds.has(translationInFlightSegment.segmentId)
      ? translationInFlightSegment.sourceText
      : "");
  const liveTranslationPreview =
    translationInFlightSegment && !finalizedSegmentIds.has(translationInFlightSegment.segmentId)
      ? translationInFlightSegment.liveTranslatedText || translationInFlightSegment.translatedText
      : "";
  const hasLiveCard = Boolean(liveSourcePreview.trim() || liveTranslationPreview.trim());
  const archivedChunks = state.finalizedSegments.map((segment) => ({
    source: segment,
    translation: translationBySegmentId.get(segment.segmentId) ?? null,
  }));
  const compactStatus = `${connectionStatusLabel[state.connectionStatus]} · ${
    micStatusLabel[state.micPermissionStatus]
  }`;

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

        <main className={styles.feed}>
          {archivedChunks.length === 0 && !hasLiveCard ? (
            <div className={styles.emptyState}>
              <p className={styles.emptyTitle}>开始后，这里会像手机翻译工具一样按消息流显示内容。</p>
              <p>
                你开口后，原文会先以 delta 增量方式持续冒字；当文本趋于稳定时，译文会开始出现；completed 到来后再归档成稳定片段。
              </p>
            </div>
          ) : null}

          {archivedChunks.map(({ source, translation }) => (
            <article key={source.segmentId} className={styles.messageCard}>
              <div className={styles.cardMeta}>
                <span>{sourceStatusLabel.final}</span>
                <span>{source.segmentId}</span>
              </div>
              <div className={styles.sourceBlock}>
                <p className={styles.blockLabel}>原文</p>
                <p className={styles.sourceText}>{source.text}</p>
              </div>
              <div className={styles.translationBlock}>
                <div className={styles.blockHeader}>
                  <p className={styles.blockLabel}>译文</p>
                  <span className={styles.blockState}>
                    {translation
                      ? `${sourceStatusLabel[translation.sourceStatus]} · ${
                          translationStatusLabel[translation.translationStatus]
                        } · rev ${translation.revision}`
                      : "等待翻译"}
                  </span>
                </div>
                <p className={styles.translationText}>
                  {translation?.translatedText ||
                    translation?.liveTranslatedText ||
                    "该片段的译文还在生成中。"}
                </p>
                {translation?.errorMessage ? (
                  <p className={styles.inlineError}>{translation.errorMessage}</p>
                ) : null}
              </div>
            </article>
          ))}

          {hasLiveCard ? (
            <article className={`${styles.messageCard} ${styles.liveMessageCard}`}>
              <div className={styles.cardMeta}>
                <span>{sourceStatusLabel.live}</span>
                <span>delta 增量显示中</span>
              </div>
              <div className={styles.sourceBlock}>
                <p className={styles.blockLabel}>原文</p>
                <p className={styles.sourceText}>{liveSourcePreview || "正在等待更多 delta..."}</p>
              </div>
              <div className={styles.translationBlock}>
                <div className={styles.blockHeader}>
                  <p className={styles.blockLabel}>译文</p>
                  <span className={styles.blockState}>
                    {translationInFlightSegment
                      ? `${translationStatusLabel[translationInFlightSegment.translationStatus]} · rev ${
                          translationInFlightSegment.activeTranslationRevision ??
                          translationInFlightSegment.revision
                        }`
                      : "等待稳定片段"}
                  </span>
                </div>
                <p className={styles.translationText}>
                  {liveTranslationPreview || "当前只先显示原文。等这段原文足够稳定后，译文会在这里开始流式出现。"}
                </p>
              </div>
            </article>
          ) : null}
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
                  <dt>Realtime Model</dt>
                  <dd>{process.env.NEXT_PUBLIC_REALTIME_MODEL_HINT ?? "server-managed"}</dd>
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
                  <dt>Live Source</dt>
                  <dd>{state.liveSourceText ? `${state.liveSourceText.length} chars` : "-"}</dd>
                </div>
                <div>
                  <dt>Live Translation</dt>
                  <dd>
                    {state.liveTranslationText ? `${state.liveTranslationText.length} chars` : "-"}
                  </dd>
                </div>
                <div>
                  <dt>Finalized Segments</dt>
                  <dd>{state.finalizedSegments.length}</dd>
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
                  <dt>Recent Revisions</dt>
                  <dd>{state.recentRevisionCount}</dd>
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
