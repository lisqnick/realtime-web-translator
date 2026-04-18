import { getLanguageConfig } from "@/lib/languages/config";
import { getScenarioById } from "@/lib/scenarios/config";
import type { TranslationPrompt, TranslationPromptInput } from "@/types/translation";

export function buildTranslationPrompt(input: TranslationPromptInput): TranslationPrompt {
  const sourceLanguage =
    getLanguageConfig(input.sourceLanguage)?.label ?? input.sourceLanguage;
  const targetLanguage =
    getLanguageConfig(input.targetLanguage)?.translationDisplayName ?? input.targetLanguage;
  const selectedPairLabels = input.selectedLanguagePair.languages
    .map((language) => getLanguageConfig(language)?.translationDisplayName ?? language)
    .join(" / ");
  const scenario = getScenarioById(input.scenario);
  const glossaryHints = input.glossaryHints ?? [];
  const isAutoSelectedPairMode = input.directionMode === "auto_selected_pair";

  const instructionLines = isAutoSelectedPairMode
    ? [
        `You are a realtime subtitle translator for the selected language pair: ${selectedPairLabels}.`,
        "You will receive spoken text that belongs to exactly one of the two selected languages.",
        "Decide which selected language the source belongs to, then translate it into the other selected language.",
        "Return only the structured result requested by the response schema.",
        "The translation must always be in the opposite language from the detected source language.",
        "When the target is Chinese, translation must use Simplified Chinese only, never Traditional Chinese.",
        "The output language must always be different from the input language.",
        "Never echo the source text, even if it is very short.",
        "Do not add markdown, explanations, summaries, notes, or comments.",
        "Keep the speaker's tone and level of formality.",
        "Be faithful and conservative. Do not embellish, soften, or expand the meaning.",
        "If the source is incomplete, hesitant, or fragmentary, preserve that quality instead of over-completing it.",
        "Use scenario hints only as weak preferences for terminology and tone.",
        "If the source clearly does not belong to the selected scenario, still translate faithfully by original meaning.",
      ]
    : [
        "You are a realtime subtitle translator.",
        `Translate spoken ${sourceLanguage} into natural ${targetLanguage}.`,
        "Output only the translated text in the target language.",
        "Do not add labels, quotation marks, explanations, summaries, or notes.",
        "Keep the speaker's tone and level of formality.",
        "Be faithful and conservative. Do not embellish, soften, or expand the meaning.",
        "If the source is incomplete, hesitant, or fragmentary, preserve that quality instead of over-completing it.",
        "Use scenario hints only as weak preferences for terminology and tone.",
        "If the source clearly does not belong to the selected scenario, still translate faithfully by original meaning.",
      ];

  if (scenario) {
    instructionLines.push(`Selected scenario: ${scenario.label}.`);
    instructionLines.push(`Scenario tone preference: ${scenario.tone}.`);

    if (scenario.rules.length > 0) {
      instructionLines.push(`Scenario rules: ${scenario.rules.join("；")}.`);
    }
  }

  if (glossaryHints.length > 0) {
    instructionLines.push(`Terminology hints: ${glossaryHints.join("；")}.`);
    instructionLines.push(
      "Prefer these terminology hints when they fit the source naturally, but never distort the original meaning.",
    );
  }

  const inputSections = isAutoSelectedPairMode
    ? [
        `Selected language pair: ${selectedPairLabels}`,
        "Source language: detect which of the selected pair the source belongs to",
        "Target language: the other language",
        scenario ? `Scenario: ${scenario.label}` : "Scenario: general",
      ]
    : [
        `Source language: ${sourceLanguage}`,
        `Target language: ${targetLanguage}`,
        scenario ? `Scenario: ${scenario.label}` : "Scenario: general",
      ];

  if (input.previousContext?.trim()) {
    inputSections.push(
      `Previous confirmed context (use only if it helps local coherence):\n${input.previousContext.trim()}`,
    );
  }

  inputSections.push(`Current source segment:\n${input.text.trim()}`);
  inputSections.push(
    isAutoSelectedPairMode
      ? "Return only the structured output that matches the provided schema. Never return the source text unchanged."
      : `Return only the translation in ${targetLanguage}.`,
  );

  return {
    instructions: instructionLines.join("\n"),
    inputText: inputSections.join("\n\n"),
    glossaryHints,
  };
}
