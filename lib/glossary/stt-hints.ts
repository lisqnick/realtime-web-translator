import type {
  ScenarioId,
  SupportedLanguageCode,
  TranslationDirectionMode,
} from "@/types/config";

interface GetSttHintTermsInput {
  directionMode?: TranslationDirectionMode;
  sourceLanguage?: SupportedLanguageCode;
  targetLanguage?: SupportedLanguageCode;
  scenario?: ScenarioId;
}

const MAX_STT_HINT_TERMS = 12;

const PAIR_HINTS: Record<string, string[]> = {
  "ja-JP__zh-CN": [
    "こんにちは",
    "ありがとうございます",
    "すみません",
    "銀行",
    "病院",
    "東京駅",
    "新宿",
    "クレジットカード",
    "レシート",
  ],
  "en-US__zh-CN": [
    "Wi-Fi",
    "USB",
    "ATM",
    "credit card",
    "receipt",
    "check-in",
    "check-out",
    "station",
    "passport",
  ],
  "en-US__ja-JP": [
    "Shinjuku",
    "Tokyo Station",
    "Wi-Fi",
    "receipt",
    "reservation",
    "hospital",
    "prescription",
  ],
};

const FIXED_HINTS: Partial<Record<SupportedLanguageCode, string[]>> = {
  "zh-CN": ["简体中文", "收据", "信用卡", "东京站", "新宿"],
  "ja-JP": ["こんにちは", "ありがとうございます", "東京駅", "レシート"],
  "en-US": ["Wi-Fi", "credit card", "receipt", "check-in"],
};

const SCENARIO_HINTS: Partial<Record<ScenarioId, string[]>> = {
  general: ["everyday conversation", "place names", "brand names"],
  shopping: ["price", "size", "color", "stock", "discount", "receipt"],
  medical: ["symptoms", "medicine", "dosage", "allergy", "appointment", "prescription"],
  banking: ["account", "transfer", "limit", "ID", "address proof", "credit card"],
  child_communication: ["simple phrases", "family terms", "school words", "comforting expressions"],
};

function normalizePairKey(
  leftLanguage: SupportedLanguageCode,
  rightLanguage: SupportedLanguageCode,
) {
  return [leftLanguage, rightLanguage].sort().join("__");
}

export function getSttHintTerms(input: GetSttHintTermsInput) {
  const terms = new Set<string>();

  if (input.directionMode === "auto_selected_pair" && input.sourceLanguage && input.targetLanguage) {
    for (const term of PAIR_HINTS[normalizePairKey(input.sourceLanguage, input.targetLanguage)] ?? []) {
      terms.add(term);
    }
  }

  if (input.directionMode === "fixed" && input.sourceLanguage) {
    for (const term of FIXED_HINTS[input.sourceLanguage] ?? []) {
      terms.add(term);
    }
  }

  if (input.scenario) {
    for (const term of SCENARIO_HINTS[input.scenario] ?? []) {
      terms.add(term);
    }
  }

  return [...terms].slice(0, MAX_STT_HINT_TERMS);
}
