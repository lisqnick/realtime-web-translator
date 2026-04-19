import { getSttHintTerms } from "@/lib/glossary/stt-hints";
import { getLanguageConfig } from "@/lib/languages/config";
import { getScenarioById } from "@/lib/scenarios/config";
import type {
  ScenarioId,
  SupportedLanguageCode,
  TranslationDirectionMode,
} from "@/types/config";

interface BuildRealtimeTranscriptionPromptInput {
  directionMode?: TranslationDirectionMode;
  sourceLanguage?: SupportedLanguageCode;
  targetLanguage?: SupportedLanguageCode;
  scenario?: ScenarioId;
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

function buildScenarioTranscriptionHints(
  scenario: ScenarioId | undefined,
) {
  if (!scenario || scenario === "general") {
    return "The conversation is everyday spoken communication.";
  }

  switch (scenario) {
    case "shopping":
      return "The conversation may include product names, price, size, color, stock, discount, payment, and receipt.";
    case "medical":
      return "The conversation may include symptoms, medicine names, dosage, allergy, fever, pain, appointment, and prescription.";
    case "banking":
      return "The conversation may include account, transfer, ID verification, limits, fees, address proof, and credit card terms.";
    case "child_communication":
      return "The conversation may include simple daily expressions, family terms, school words, and child-related vocabulary.";
    default:
      return null;
  }
}

function buildHintLine(
  input: BuildRealtimeTranscriptionPromptInput,
) {
  const hintTerms = getSttHintTerms(input);

  if (hintTerms.length === 0) {
    return null;
  }

  return `Important names and terms may include: ${hintTerms.join(", ")}.`;
}

function buildAutoPairRealtimeTranscriptionPrompt(
  leftLanguage: SupportedLanguageCode,
  rightLanguage: SupportedLanguageCode,
  scenario?: ScenarioId,
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

  const scenarioHints = buildScenarioTranscriptionHints(scenario);
  if (scenarioHints) {
    lines.push(scenarioHints);
  }

  const hintLine = buildHintLine({
    directionMode: "auto_selected_pair",
    sourceLanguage: leftLanguage,
    targetLanguage: rightLanguage,
    scenario,
  });
  if (hintLine) {
    lines.push(hintLine);
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
      input.scenario,
    );
  }

  const fixedSourceLanguage = input.sourceLanguage ?? "zh-CN";
  const lines = [buildFixedRealtimeTranscriptionPrompt(fixedSourceLanguage)];
  const scenarioHints = buildScenarioTranscriptionHints(input.scenario);
  if (scenarioHints) {
    lines.push(scenarioHints);
  }
  const hintLine = buildHintLine({
    directionMode: "fixed",
    sourceLanguage: fixedSourceLanguage,
    targetLanguage: input.targetLanguage,
    scenario: input.scenario,
  });
  if (hintLine) {
    lines.push(hintLine);
  }

  return lines.join(" ");
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
    const scenarioLabel = input.scenario
      ? (getScenarioById(input.scenario)?.label ?? input.scenario)
      : "通用";
    const hints = getSttHintTerms(input).length;
    return `auto pair: ${leftLabel} <-> ${rightLabel} | scenario: ${scenarioLabel} | hints: ${hints}`;
  }

  const sourceLanguage = input.sourceLanguage ?? "zh-CN";
  const scenarioLabel = input.scenario
    ? (getScenarioById(input.scenario)?.label ?? input.scenario)
    : "通用";
  const hints = getSttHintTerms({
    directionMode: "fixed",
    sourceLanguage,
    targetLanguage: input.targetLanguage,
    scenario: input.scenario,
  }).length;
  return `fixed: ${getLanguageConfig(sourceLanguage)?.label ?? sourceLanguage} | scenario: ${scenarioLabel} | hints: ${hints}`;
}
