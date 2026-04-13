import { getLanguageConfig } from "@/lib/languages/config";
import { getScenarioById } from "@/lib/scenarios/config";
import type { TranslationPrompt, TranslationPromptInput } from "@/types/translation";

export function buildTranslationPrompt(input: TranslationPromptInput): TranslationPrompt {
  const sourceLanguage =
    getLanguageConfig(input.sourceLanguage)?.label ?? input.sourceLanguage;
  const targetLanguage =
    getLanguageConfig(input.targetLanguage)?.translationDisplayName ?? input.targetLanguage;
  const scenario = getScenarioById(input.scenario);
  const glossaryHints = input.glossaryHints ?? [];
  const isAutoZhJaMode = input.directionMode === "auto_zh_ja";

  const instructionLines = isAutoZhJaMode
    ? [
        "You are a realtime subtitle translator for Simplified Chinese and Japanese.",
        "You will receive spoken text that is either Simplified Chinese or Japanese.",
        "Detect whether the source is Simplified Chinese or Japanese, then translate it into the other language.",
        "Return strict JSON only, with exactly these two fields:",
        '{"detected_source_language":"zh","translation":"..."}',
        'or {"detected_source_language":"ja","translation":"..."}',
        'The field detected_source_language must be either "zh" or "ja".',
        "If detected_source_language is zh, translation must be natural Japanese.",
        "If detected_source_language is ja, translation must be natural Simplified Chinese.",
        "When the target is Chinese, translation must use Simplified Chinese only, never Traditional Chinese.",
        "The output language must always be different from the input language.",
        "Never echo the source text, even if it is very short.",
        "Do not add any extra keys, markdown, explanations, summaries, notes, or comments.",
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

  const inputSections = isAutoZhJaMode
    ? [
        "Source language: auto-detect between Simplified Chinese and Japanese",
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
    isAutoZhJaMode
      ? 'Return strict JSON only. Example: {"detected_source_language":"zh","translation":"こんにちは"}. Never return the source text unchanged.'
      : `Return only the translation in ${targetLanguage}.`,
  );

  return {
    instructions: instructionLines.join("\n"),
    inputText: inputSections.join("\n\n"),
    glossaryHints,
  };
}
