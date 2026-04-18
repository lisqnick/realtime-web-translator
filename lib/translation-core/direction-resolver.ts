import type {
  SelectedLanguagePair,
  SupportedLanguageCode,
  TranslationDirectionMode,
  TranslationMode,
} from "@/types/config";

import type { ResolvedTranslationDirection } from "@/lib/translation-core/types";

export function createSelectedLanguagePair(input: {
  directionMode: TranslationDirectionMode;
  sourceLanguage: SupportedLanguageCode;
  targetLanguage: SupportedLanguageCode;
}): SelectedLanguagePair {
  if (input.directionMode === "auto_selected_pair") {
    return {
      languages: [input.sourceLanguage, input.targetLanguage],
      mode: "bidirectional_auto",
    };
  }

  return {
    languages: [input.sourceLanguage, input.targetLanguage],
    mode: "fixed",
  };
}

export function resolveTranslationDirection(input: {
  selectedLanguagePair: SelectedLanguagePair;
  fixedSourceLanguage?: SupportedLanguageCode;
  fixedTargetLanguage?: SupportedLanguageCode;
  detectedSourceLanguage?: SupportedLanguageCode | null;
}): ResolvedTranslationDirection {
  if (input.selectedLanguagePair.mode === "fixed") {
    const [defaultSourceLanguage, defaultTargetLanguage] = input.selectedLanguagePair.languages;

    return {
      resolvedSourceLanguage: input.fixedSourceLanguage ?? defaultSourceLanguage,
      resolvedTargetLanguage: input.fixedTargetLanguage ?? defaultTargetLanguage,
      confidence: 1,
      status: "resolved",
    };
  }

  const detectedSourceLanguage = input.detectedSourceLanguage ?? null;

  if (!detectedSourceLanguage) {
    return rejectedDirection(input.selectedLanguagePair.mode);
  }

  const [languageA, languageB] = input.selectedLanguagePair.languages;

  if (detectedSourceLanguage === languageA) {
    return {
      resolvedSourceLanguage: languageA,
      resolvedTargetLanguage: languageB,
      confidence: 1,
      status: "resolved",
    };
  }

  if (detectedSourceLanguage === languageB) {
    return {
      resolvedSourceLanguage: languageB,
      resolvedTargetLanguage: languageA,
      confidence: 1,
      status: "resolved",
    };
  }

  return rejectedDirection(input.selectedLanguagePair.mode);
}

function rejectedDirection(mode: TranslationMode): ResolvedTranslationDirection {
  const fallbackLanguage: SupportedLanguageCode =
    mode === "bidirectional_auto" ? "zh-CN" : "zh-CN";

  return {
    resolvedSourceLanguage: fallbackLanguage,
    resolvedTargetLanguage: fallbackLanguage,
    confidence: 0,
    status: "rejected",
  };
}
