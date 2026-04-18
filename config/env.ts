import "server-only";

import {
  DEFAULT_UI_DIRECTION_ID,
  getUiDirectionById,
  isSupportedLanguageCode,
  resolveUiDirection,
} from "@/lib/languages/config";
import { DEFAULT_SCENARIO_ID, isScenarioId } from "@/lib/scenarios/config";
import type {
  NodeEnv,
  PublicRuntimeDefaults,
  SupportedLanguageCode,
  TranslationMode,
} from "@/types/config";

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

function normalizeTranslationMode(value: string | undefined): TranslationMode {
  if (value === "fixed") {
    return "fixed";
  }

  return "bidirectional_auto";
}

function normalizeRuntimeLanguage(
  value: string | undefined,
  fallback: SupportedLanguageCode,
) {
  return isSupportedLanguageCode(value) ? value : fallback;
}

function normalizeRuntimeLanguageDefaults(input: {
  leftLanguage: SupportedLanguageCode;
  rightLanguage: SupportedLanguageCode;
}) {
  if (input.leftLanguage !== input.rightLanguage) {
    return input;
  }

  return {
    leftLanguage: "zh-CN" as const,
    rightLanguage: "ja-JP" as const,
  };
}

function resolveLegacyDirectionId(input: {
  leftLanguage: SupportedLanguageCode;
  rightLanguage: SupportedLanguageCode;
  translationMode: TranslationMode;
}) {
  if (
    input.translationMode === "bidirectional_auto" &&
    ((input.leftLanguage === "zh-CN" && input.rightLanguage === "ja-JP") ||
      (input.leftLanguage === "ja-JP" && input.rightLanguage === "zh-CN"))
  ) {
    return "zh-ja-auto" as const;
  }

  return (
    resolveUiDirection(input.leftLanguage, input.rightLanguage)?.id ??
    getUiDirectionById(DEFAULT_UI_DIRECTION_ID)!.id
  );
}

const nodeEnv = normalizeNodeEnv(process.env.NODE_ENV);
const defaultScenarioId = isScenarioId(process.env.DEFAULT_SCENARIO)
  ? process.env.DEFAULT_SCENARIO
  : DEFAULT_SCENARIO_ID;
const defaultTranslationMode = normalizeTranslationMode(
  process.env.DEFAULT_TRANSLATION_MODE,
);
const normalizedRuntimeLanguages = normalizeRuntimeLanguageDefaults({
  leftLanguage: normalizeRuntimeLanguage(process.env.DEFAULT_LEFT_LANGUAGE, "zh-CN"),
  rightLanguage: normalizeRuntimeLanguage(process.env.DEFAULT_RIGHT_LANGUAGE, "ja-JP"),
});
const defaultLeftLanguage = normalizedRuntimeLanguages.leftLanguage;
const defaultRightLanguage = normalizedRuntimeLanguages.rightLanguage;
const compatibilityDirectionId = resolveLegacyDirectionId({
  leftLanguage: defaultLeftLanguage,
  rightLanguage: defaultRightLanguage,
  translationMode: defaultTranslationMode,
});

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
    sourceLanguage: defaultLeftLanguage,
    targetLanguage: defaultRightLanguage,
    scenario: defaultScenarioId,
    glossaryEnabled: parseBoolean(process.env.GLOSSARY_ENABLED, true),
    debugPerfLogs: parseBoolean(process.env.DEBUG_PERF_LOGS, nodeEnv === "development"),
  },
};

export const publicRuntimeDefaults: PublicRuntimeDefaults = {
  defaultDirectionId: compatibilityDirectionId,
  defaultLeftLanguage,
  defaultRightLanguage,
  defaultTranslationMode,
  defaultScenarioId,
  appBaseUrl: serverEnv.appBaseUrl,
  glossaryEnabled: serverEnv.defaults.glossaryEnabled,
  debugPerfLogs: serverEnv.defaults.debugPerfLogs,
  nodeEnv,
};
