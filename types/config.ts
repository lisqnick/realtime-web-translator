export type SupportedLanguageCode = "zh-CN" | "ja-JP" | "en-US" | "ko-KR";

export type TranslationDirectionMode = "fixed" | "auto_zh_ja";
export type TranslationMode = "fixed" | "bidirectional_auto";

export type UiLanguageDirectionId =
  | "zh-CN__ja-JP"
  | "ja-JP__zh-CN"
  | "zh-ja-auto";

export type ScenarioId =
  | "general"
  | "shopping"
  | "medical"
  | "banking"
  | "child_communication";

export type TranslationAppStatus =
  | "idle"
  | "requesting_mic"
  | "creating_session"
  | "connecting_realtime"
  | "listening"
  | "stopping"
  | "stopped"
  | "error";

export type MicPermissionStatus =
  | "not_requested"
  | "prompt"
  | "granted"
  | "denied"
  | "unsupported"
  | "error";

export type StatusTone = "neutral" | "accent" | "success" | "warning" | "danger";

export type NodeEnv = "development" | "production" | "test";

export interface LanguageConfig {
  label: string;
  code: SupportedLanguageCode;
  locale: string;
  speechRecognitionHint: string;
  translationDisplayName: string;
  enabled: boolean;
}

export interface UiLanguageDirection {
  id: UiLanguageDirectionId;
  label: string;
  mode: TranslationDirectionMode;
  sourceLanguage: SupportedLanguageCode;
  targetLanguage: SupportedLanguageCode;
  sourceLabel: string;
  targetLabel: string;
  enabled: boolean;
}

export interface SelectedLanguagePair {
  languages: [SupportedLanguageCode, SupportedLanguageCode];
  mode: TranslationMode;
}

export interface ScenarioConfig {
  id: ScenarioId;
  label: string;
  description: string;
  tone: string;
  rules: string[];
  glossaryHints: string[];
  enabled: boolean;
}

export interface PublicRuntimeDefaults {
  defaultDirectionId: UiLanguageDirectionId;
  defaultScenarioId: ScenarioId;
  appBaseUrl: string;
  glossaryEnabled: boolean;
  debugPerfLogs: boolean;
  nodeEnv: NodeEnv;
}
