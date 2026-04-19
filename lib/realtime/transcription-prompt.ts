import { getLanguageConfig } from "@/lib/languages/config";
import type {
  SupportedLanguageCode,
  TranslationDirectionMode,
} from "@/types/config";

interface BuildRealtimeTranscriptionPromptInput {
  directionMode?: TranslationDirectionMode;
  sourceLanguage?: SupportedLanguageCode;
  targetLanguage?: SupportedLanguageCode;
}

const EXTRA_FORBIDDEN_LANGUAGE_HINTS = ["Korean"];

function getTranscriptionLanguageName(language: SupportedLanguageCode) {
  switch (language) {
    case "zh-CN":
      return "Simplified Chinese";
    case "ja-JP":
      return "Japanese";
    case "en-US":
      return "English";
    case "ko-KR":
      return "Korean";
    case "es-ES":
      return "Spanish";
    case "fr-FR":
      return "French";
    case "ar-SA":
      return "Arabic";
    case "pt-BR":
      return "Portuguese";
    case "de-DE":
      return "German";
  }
}

function buildFixedRealtimeTranscriptionPrompt(sourceLanguage: SupportedLanguageCode) {
  const languageName = getTranscriptionLanguageName(sourceLanguage);
  const lines = [
    `Audio is in ${languageName}.`,
    "Transcribe only what is spoken.",
    "Do not translate.",
    `Output ${languageName} only.`,
    "Preserve the speaker's wording as spoken.",
  ];

  if (sourceLanguage === "zh-CN") {
    lines.push("When the speech is Chinese, output Simplified Chinese only.");
  }

  return lines.join(" ");
}

function buildAutoPairRealtimeTranscriptionPrompt(
  leftLanguage: SupportedLanguageCode,
  rightLanguage: SupportedLanguageCode,
) {
  const pairNames = [getTranscriptionLanguageName(leftLanguage), getTranscriptionLanguageName(rightLanguage)];
  const excludedLanguageHints = [
    ...new Set(
      EXTRA_FORBIDDEN_LANGUAGE_HINTS.filter(
        (languageName) => !pairNames.includes(languageName),
      ),
    ),
  ];

  const lines = [
    `Audio will be either ${pairNames[0]} or ${pairNames[1]}.`,
    "Transcribe only what is spoken.",
    "Do not translate.",
    `Output only ${pairNames[0]} or ${pairNames[1]}.`,
  ];

  if (excludedLanguageHints.length > 0) {
    lines.push(`Never output ${excludedLanguageHints.join(", ")} or any other language.`);
  } else {
    lines.push("Never output any language outside this selected pair.");
  }

  if (leftLanguage === "zh-CN" || rightLanguage === "zh-CN") {
    lines.push("If the speech is Chinese, output Simplified Chinese.");
  }

  return lines.join(" ");
}

export function buildRealtimeTranscriptionPrompt(
  input: BuildRealtimeTranscriptionPromptInput,
) {
  if (
    input.directionMode === "auto_selected_pair" &&
    input.sourceLanguage &&
    input.targetLanguage
  ) {
    return buildAutoPairRealtimeTranscriptionPrompt(
      input.sourceLanguage,
      input.targetLanguage,
    );
  }

  const fixedSourceLanguage = input.sourceLanguage ?? "zh-CN";
  return buildFixedRealtimeTranscriptionPrompt(fixedSourceLanguage);
}

export function buildRealtimeTranscriptionPromptSummary(
  input: BuildRealtimeTranscriptionPromptInput,
) {
  if (
    input.directionMode === "auto_selected_pair" &&
    input.sourceLanguage &&
    input.targetLanguage
  ) {
    const leftLabel = getLanguageConfig(input.sourceLanguage)?.label ?? input.sourceLanguage;
    const rightLabel = getLanguageConfig(input.targetLanguage)?.label ?? input.targetLanguage;
    return `auto pair: ${leftLabel} <-> ${rightLabel}`;
  }

  const sourceLanguage = input.sourceLanguage ?? "zh-CN";
  return `fixed: ${getLanguageConfig(sourceLanguage)?.label ?? sourceLanguage}`;
}
