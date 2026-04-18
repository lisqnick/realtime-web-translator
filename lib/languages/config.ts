import type {
  LanguageConfig,
  SupportedLanguageCode,
  TranslationMode,
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
  {
    label: "西班牙语",
    code: "es-ES",
    locale: "es-ES",
    speechRecognitionHint: "Spanish",
    translationDisplayName: "Español",
    enabled: true,
  },
  {
    label: "法语",
    code: "fr-FR",
    locale: "fr-FR",
    speechRecognitionHint: "French",
    translationDisplayName: "Français",
    enabled: true,
  },
  {
    label: "阿拉伯语",
    code: "ar-SA",
    locale: "ar-SA",
    speechRecognitionHint: "Arabic",
    translationDisplayName: "العربية",
    enabled: true,
  },
  {
    label: "葡萄牙语",
    code: "pt-BR",
    locale: "pt-BR",
    speechRecognitionHint: "Portuguese",
    translationDisplayName: "Português",
    enabled: true,
  },
  {
    label: "德语",
    code: "de-DE",
    locale: "de-DE",
    speechRecognitionHint: "German",
    translationDisplayName: "Deutsch",
    enabled: true,
  },
];

export const FIXED_TRANSLATION_LANGUAGE_CODES = [
  "zh-CN",
  "ja-JP",
  "en-US",
  "ko-KR",
  "es-ES",
  "fr-FR",
  "ar-SA",
  "pt-BR",
  "de-DE",
] as const satisfies readonly SupportedLanguageCode[];

export const AUTO_BIDIRECTIONAL_LANGUAGE_PAIRS = [
  ["zh-CN", "ja-JP"],
  ["zh-CN", "en-US"],
  ["ja-JP", "en-US"],
] as const satisfies readonly [SupportedLanguageCode, SupportedLanguageCode][];

export const AUTO_BIDIRECTIONAL_LANGUAGE_CODES = Array.from(
  new Set(AUTO_BIDIRECTIONAL_LANGUAGE_PAIRS.flatMap((pair) => pair)),
) as readonly SupportedLanguageCode[];

const languageIndex = new Map(languageCatalog.map((language) => [language.code, language]));
const languageCodeSet = new Set(languageCatalog.map((language) => language.code));
const fixedLanguageCodeSet = new Set<SupportedLanguageCode>(FIXED_TRANSLATION_LANGUAGE_CODES);

export function isSupportedLanguageCode(
  value: string | undefined,
): value is SupportedLanguageCode {
  return value !== undefined && languageCodeSet.has(value as SupportedLanguageCode);
}

export function getLanguageConfig(code: SupportedLanguageCode) {
  return languageIndex.get(code);
}

export function getEnabledLanguageConfigs(mode?: TranslationMode) {
  const enabledLanguages = languageCatalog.filter((language) => language.enabled);

  if (mode === "bidirectional_auto") {
    return enabledLanguages.filter((language) =>
      AUTO_BIDIRECTIONAL_LANGUAGE_CODES.includes(language.code),
    );
  }

  return enabledLanguages.filter((language) =>
    fixedLanguageCodeSet.has(language.code),
  );
}

export function isFixedTranslationLanguageSupported(code: SupportedLanguageCode) {
  return fixedLanguageCodeSet.has(code);
}

export function isBidirectionalAutoLanguagePairSupported(
  leftLanguage: SupportedLanguageCode,
  rightLanguage: SupportedLanguageCode,
) {
  return AUTO_BIDIRECTIONAL_LANGUAGE_PAIRS.some(
    ([languageA, languageB]) =>
      (leftLanguage === languageA && rightLanguage === languageB) ||
      (leftLanguage === languageB && rightLanguage === languageA),
  );
}
