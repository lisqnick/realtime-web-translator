import type {
  LanguageConfig,
  SupportedLanguageCode,
  TranslationDirectionMode,
  UiLanguageDirection,
  UiLanguageDirectionId,
} from "@/types/config";

export const languageCatalog: LanguageConfig[] = [
  {
    label: "中文",
    code: "zh-CN",
    locale: "zh-CN",
    speechRecognitionHint: "Mandarin Chinese",
    translationDisplayName: "简体中文",
    enabled: true,
  },
  {
    label: "日语",
    code: "ja-JP",
    locale: "ja-JP",
    speechRecognitionHint: "Japanese",
    translationDisplayName: "日本語",
    enabled: true,
  },
  {
    label: "英语",
    code: "en-US",
    locale: "en-US",
    speechRecognitionHint: "American English",
    translationDisplayName: "English",
    enabled: true,
  },
  {
    label: "韩语",
    code: "ko-KR",
    locale: "ko-KR",
    speechRecognitionHint: "Korean",
    translationDisplayName: "한국어",
    enabled: true,
  },
];

export const uiLanguageDirections: UiLanguageDirection[] = [
  {
    id: "zh-CN__ja-JP",
    label: "中文 -> 日语",
    mode: "fixed",
    sourceLanguage: "zh-CN",
    targetLanguage: "ja-JP",
    sourceLabel: "中文",
    targetLabel: "日语",
    enabled: true,
  },
  {
    id: "ja-JP__zh-CN",
    label: "日语 -> 中文",
    mode: "fixed",
    sourceLanguage: "ja-JP",
    targetLanguage: "zh-CN",
    sourceLabel: "日语",
    targetLabel: "中文",
    enabled: true,
  },
  {
    id: "zh-ja-auto",
    label: "中日自动互译",
    mode: "auto_zh_ja",
    sourceLanguage: "zh-CN",
    targetLanguage: "zh-CN",
    sourceLabel: "中文 / 日语",
    targetLabel: "自动互译",
    enabled: true,
  },
];

export const DEFAULT_UI_DIRECTION_ID: UiLanguageDirectionId = "zh-CN__ja-JP";

const languageIndex = new Map(languageCatalog.map((language) => [language.code, language]));
const directionIndex = new Map(uiLanguageDirections.map((direction) => [direction.id, direction]));
const languageCodeSet = new Set(languageCatalog.map((language) => language.code));
const uiDirectionCycleOrder: UiLanguageDirectionId[] = [
  "zh-CN__ja-JP",
  "zh-ja-auto",
  "ja-JP__zh-CN",
];

export function isSupportedLanguageCode(
  value: string | undefined,
): value is SupportedLanguageCode {
  return value !== undefined && languageCodeSet.has(value as SupportedLanguageCode);
}

export function getLanguageConfig(code: SupportedLanguageCode) {
  return languageIndex.get(code);
}

export function getUiDirectionById(id: UiLanguageDirectionId) {
  return directionIndex.get(id);
}

export function getNextUiDirectionId(currentId: UiLanguageDirectionId) {
  const currentIndex = uiDirectionCycleOrder.indexOf(currentId);

  if (currentIndex === -1) {
    return uiDirectionCycleOrder[0];
  }

  return uiDirectionCycleOrder[(currentIndex + 1) % uiDirectionCycleOrder.length];
}

export function isAutoZhJaDirectionMode(mode: TranslationDirectionMode) {
  return mode === "auto_zh_ja";
}

export function isAutoZhJaLanguagePair(
  sourceLanguage: SupportedLanguageCode,
  targetLanguage: SupportedLanguageCode,
) {
  return sourceLanguage === "zh-CN" && targetLanguage === "zh-CN";
}

export function resolveUiDirection(
  sourceLanguage: SupportedLanguageCode,
  targetLanguage: SupportedLanguageCode,
) {
  return uiLanguageDirections.find(
    (direction) =>
      direction.sourceLanguage === sourceLanguage &&
      direction.targetLanguage === targetLanguage,
  );
}
