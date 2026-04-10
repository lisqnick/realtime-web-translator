import type {
  LanguageConfig,
  SupportedLanguageCode,
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
    sourceLanguage: "zh-CN",
    targetLanguage: "ja-JP",
    enabled: true,
  },
  {
    id: "ja-JP__zh-CN",
    label: "日语 -> 中文",
    sourceLanguage: "ja-JP",
    targetLanguage: "zh-CN",
    enabled: true,
  },
];

export const DEFAULT_UI_DIRECTION_ID: UiLanguageDirectionId = "zh-CN__ja-JP";

const languageIndex = new Map(languageCatalog.map((language) => [language.code, language]));
const directionIndex = new Map(uiLanguageDirections.map((direction) => [direction.id, direction]));
const languageCodeSet = new Set(languageCatalog.map((language) => language.code));

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
