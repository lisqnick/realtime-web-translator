import { normalizeToSimplifiedChinese } from "@/lib/translation/normalize-chinese";
import type { SelectedLanguagePair, SupportedLanguageCode } from "@/types/config";

import { resolveTranslationDirection } from "@/lib/translation-core/direction-resolver";

const JAPANESE_KANA_REGEX = /[\u3040-\u30ff\u31f0-\u31ff]/u;

export function isBidirectionalAutoPairSupported(selectedLanguagePair: SelectedLanguagePair) {
  const [languageA, languageB] = selectedLanguagePair.languages;

  return (
    selectedLanguagePair.mode === "bidirectional_auto" &&
    ((languageA === "zh-CN" && languageB === "ja-JP") ||
      (languageA === "ja-JP" && languageB === "zh-CN"))
  );
}

export function buildAutomaticTranslationJsonSchema(
  selectedLanguagePair: SelectedLanguagePair,
) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      detected_source_language: {
        type: "string",
        enum: selectedLanguagePair.languages,
      },
      translation: {
        type: "string",
      },
    },
    required: ["detected_source_language", "translation"],
  } as const;
}

export function normalizeTranslationForTargetLanguage(
  targetLanguage: SupportedLanguageCode,
  text: string,
) {
  if (targetLanguage === "zh-CN") {
    return normalizeToSimplifiedChinese(text);
  }

  return text;
}

export function validateAutomaticTranslationResult(input: {
  selectedLanguagePair: SelectedLanguagePair;
  sourceText: string;
  detectedSourceLanguage: SupportedLanguageCode | null;
  translation: string;
}) {
  if (!input.translation.trim()) {
    return {
      ok: false as const,
      code: "empty_auto_translation",
      message: "自动互译结果为空。",
    };
  }

  const resolution = resolveTranslationDirection({
    selectedLanguagePair: input.selectedLanguagePair,
    detectedSourceLanguage: input.detectedSourceLanguage,
  });

  if (resolution.status !== "resolved") {
    return {
      ok: false as const,
      code: "invalid_auto_detected_language",
      message: "自动互译未能确认输入语言。",
    };
  }

  const normalizedTranslation = normalizeTranslationForTargetLanguage(
    resolution.resolvedTargetLanguage,
    input.translation.trim(),
  ).trim();

  if (!normalizedTranslation) {
    return {
      ok: false as const,
      code: "empty_auto_translation_after_normalize",
      message: "自动互译结果为空。",
    };
  }

  if (normalizeComparableText(normalizedTranslation) === normalizeComparableText(input.sourceText)) {
    return {
      ok: false as const,
      code: "invalid_auto_translation_same_as_source",
      message: "自动互译输出与原文相同。",
    };
  }

  if (
    resolution.resolvedTargetLanguage === "ja-JP" &&
    !JAPANESE_KANA_REGEX.test(normalizedTranslation)
  ) {
    return {
      ok: false as const,
      code: "invalid_auto_target_language",
      message: "自动互译未输出可信的日文结果。",
    };
  }

  if (
    resolution.resolvedTargetLanguage === "zh-CN" &&
    JAPANESE_KANA_REGEX.test(normalizedTranslation)
  ) {
    return {
      ok: false as const,
      code: "invalid_auto_target_language",
      message: "自动互译未输出可信的简体中文结果。",
    };
  }

  return {
    ok: true as const,
    resolvedSourceLanguage: resolution.resolvedSourceLanguage,
    resolvedTargetLanguage: resolution.resolvedTargetLanguage,
    translation: normalizedTranslation,
  };
}

function normalizeComparableText(text: string) {
  return text.replace(/\s+/g, "").trim();
}
