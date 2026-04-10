import { getScenarioById } from "@/lib/scenarios/config";
import type { ScenarioId, SupportedLanguageCode } from "@/types/config";

interface GlossaryHintCatalogEntry {
  id: string;
  sourceLanguage: SupportedLanguageCode;
  targetLanguage: SupportedLanguageCode;
  scenario?: ScenarioId;
  hints: string[];
}

const glossaryHintCatalog: GlossaryHintCatalogEntry[] = [];

export function resolveGlossaryHints(options: {
  sourceLanguage: SupportedLanguageCode;
  targetLanguage: SupportedLanguageCode;
  scenario: ScenarioId;
  glossaryId?: string | null;
}) {
  const scenarioHints = getScenarioById(options.scenario)?.glossaryHints ?? [];
  const glossaryHints = options.glossaryId
    ? glossaryHintCatalog
        .filter(
          (entry) =>
            entry.id === options.glossaryId &&
            entry.sourceLanguage === options.sourceLanguage &&
            entry.targetLanguage === options.targetLanguage &&
            (entry.scenario === undefined || entry.scenario === options.scenario),
        )
        .flatMap((entry) => entry.hints)
    : [];

  return [...new Set([...scenarioHints, ...glossaryHints])];
}
