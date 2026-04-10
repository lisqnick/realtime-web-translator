import "server-only";

import {
  DEFAULT_UI_DIRECTION_ID,
  getUiDirectionById,
  isSupportedLanguageCode,
  resolveUiDirection,
} from "@/lib/languages/config";
import { DEFAULT_SCENARIO_ID, isScenarioId } from "@/lib/scenarios/config";
import type { NodeEnv, PublicRuntimeDefaults } from "@/types/config";

const LOCAL_APP_BASE_URL = "http://localhost:3000";
const DEFAULT_REALTIME_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";
const DEFAULT_TRANSLATION_MODEL = "gpt-4o-mini";

function readString(value: string | undefined, fallback: string) {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim();
  return normalized || fallback;
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function normalizeNodeEnv(value: string | undefined): NodeEnv {
  if (value === "production" || value === "test") {
    return value;
  }

  return "development";
}

const nodeEnv = normalizeNodeEnv(process.env.NODE_ENV);
const sourceLanguage = isSupportedLanguageCode(process.env.DEFAULT_SOURCE_LANGUAGE)
  ? process.env.DEFAULT_SOURCE_LANGUAGE
  : "zh-CN";
const targetLanguage = isSupportedLanguageCode(process.env.DEFAULT_TARGET_LANGUAGE)
  ? process.env.DEFAULT_TARGET_LANGUAGE
  : "ja-JP";
const resolvedDirection =
  resolveUiDirection(sourceLanguage, targetLanguage) ??
  getUiDirectionById(DEFAULT_UI_DIRECTION_ID)!;
const defaultScenarioId = isScenarioId(process.env.DEFAULT_SCENARIO)
  ? process.env.DEFAULT_SCENARIO
  : DEFAULT_SCENARIO_ID;

export const serverEnv = {
  openAiApiKey: readString(process.env.OPENAI_API_KEY, ""),
  realtimeTranscriptionModel: readString(
    process.env.OPENAI_REALTIME_TRANSCRIPTION_MODEL,
    DEFAULT_REALTIME_TRANSCRIPTION_MODEL,
  ),
  translationModel: readString(
    process.env.OPENAI_TRANSLATION_MODEL,
    DEFAULT_TRANSLATION_MODEL,
  ),
  appBaseUrl: readString(process.env.APP_BASE_URL, LOCAL_APP_BASE_URL),
  nodeEnv,
  defaults: {
    sourceLanguage: resolvedDirection.sourceLanguage,
    targetLanguage: resolvedDirection.targetLanguage,
    scenario: defaultScenarioId,
    glossaryEnabled: parseBoolean(process.env.GLOSSARY_ENABLED, true),
    debugPerfLogs: parseBoolean(process.env.DEBUG_PERF_LOGS, nodeEnv === "development"),
  },
};

export const publicRuntimeDefaults: PublicRuntimeDefaults = {
  defaultDirectionId: resolvedDirection.id,
  defaultScenarioId,
  appBaseUrl: serverEnv.appBaseUrl,
  glossaryEnabled: serverEnv.defaults.glossaryEnabled,
  debugPerfLogs: serverEnv.defaults.debugPerfLogs,
  nodeEnv,
};
