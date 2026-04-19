import type {
  MicPermissionStatus,
  SupportedLanguageCode,
  TranslationDirectionMode,
  TranslationAppStatus,
} from "@/types/config";
import type {
  BubbleDebugSnapshot,
  TranslationBubble,
} from "@/types/bubble";
import type {
  TranslatedSegment,
  TranslationRequestState,
  TranslationTaskSummary,
} from "@/types/translation";

export type RealtimeConnectionStatus =
  | "disconnected"
  | "creating_session"
  | "connecting"
  | "connected"
  | "error";

export type RealtimeTranscriptionLanguage =
  | "zh"
  | "ja"
  | "en"
  | "ko"
  | "es"
  | "fr"
  | "ar"
  | "pt"
  | "de";
export type AudioRuntimeMode = "normal" | "noisy";
export type RealtimeVadMode = "server_vad";
export type RealtimeNoiseReductionType = "near_field" | "far_field" | "none";

export interface RealtimeSessionRequest {
  directionMode?: TranslationDirectionMode;
  sourceLanguage?: SupportedLanguageCode;
  targetLanguage?: SupportedLanguageCode;
  audioRuntimeMode?: AudioRuntimeMode;
}

export interface RealtimeClientSecret {
  value: string;
  expiresAt: number | null;
}

export interface RealtimeTurnDetectionConfig {
  type: RealtimeVadMode;
  threshold: number;
  prefixPaddingMs: number;
  silenceDurationMs: number;
}

export interface RealtimeTranscriptionSessionSummary {
  id: string;
  type: "transcription";
  expiresAt: number | null;
  model: string;
  language: RealtimeTranscriptionLanguage | null;
  audioRuntimeMode: AudioRuntimeMode;
  turnDetection: RealtimeTurnDetectionConfig;
  promptSummary: string | null;
  logprobsEnabled: boolean;
  include: string[];
}

export interface RealtimeSessionResponse {
  ok: true;
  clientSecret: RealtimeClientSecret;
  session: RealtimeTranscriptionSessionSummary;
}

export interface ApiErrorResponse {
  ok: false;
  error: {
    code: string;
    message: string;
    status?: number;
    requestId?: string | null;
  };
}

export interface RealtimeConnectionSnapshot {
  connectionStatus: RealtimeConnectionStatus;
  peerConnectionState: RTCPeerConnectionState | "new";
  iceConnectionState: RTCIceConnectionState | "new";
  signalingState: RTCSignalingState | "stable";
  dataChannelState: RTCDataChannelState | "closed";
  sessionId: string | null;
  lastEventType: string | null;
}

export interface RealtimeServerEvent {
  type?: string;
  [key: string]: unknown;
}

export type RealtimeTimelineEventType =
  | "input_audio_buffer.speech_started"
  | "input_audio_buffer.speech_stopped"
  | "input_audio_buffer.committed"
  | "conversation.item.input_audio_transcription.delta"
  | "conversation.item.input_audio_transcription.completed";

export interface RealtimeTimelineEntry {
  eventType: RealtimeTimelineEventType;
  itemId: string | null;
  contentIndex: number | null;
  arrivedAt: number;
  elapsedMsFromMicStart: number | null;
  textLength: number | null;
}

export type ParsedRealtimeEvent =
  | ParsedTranscriptSpeechStartedEvent
  | ParsedTranscriptSpeechStoppedEvent
  | ParsedTranscriptDeltaEvent
  | ParsedTranscriptSegmentEvent
  | ParsedTranscriptCompletedEvent
  | ParsedTranscriptCommittedEvent
  | ParsedTranscriptIgnoredEvent
  | ParsedTranscriptInvalidEvent;

export interface ParsedTranscriptSpeechStartedEvent {
  kind: "input_audio_buffer_speech_started";
  type: "input_audio_buffer.speech_started";
}

export interface ParsedTranscriptSpeechStoppedEvent {
  kind: "input_audio_buffer_speech_stopped";
  type: "input_audio_buffer.speech_stopped";
}

export interface ParsedTranscriptDeltaEvent {
  kind: "transcript_delta";
  type: "conversation.item.input_audio_transcription.delta";
  itemId: string;
  contentIndex: number;
  delta: string;
}

export interface ParsedTranscriptCompletedEvent {
  kind: "transcript_completed";
  type: "conversation.item.input_audio_transcription.completed";
  itemId: string;
  contentIndex: number;
  transcript: string;
  avgLogprob?: number | null;
}

export interface ParsedTranscriptSegmentEvent {
  kind: "transcript_segment";
  type: "conversation.item.input_audio_transcription.segment";
  itemId: string;
  contentIndex: number;
  text: string;
}

export interface ParsedTranscriptCommittedEvent {
  kind: "input_audio_buffer_committed";
  type: "input_audio_buffer.committed";
  itemId: string;
  previousItemId: string | null;
}

export interface ParsedTranscriptIgnoredEvent {
  kind: "ignored";
  type: string;
}

export interface ParsedTranscriptInvalidEvent {
  kind: "invalid";
  type: string;
  reason: string;
}

export interface TranscriptSegment {
  segmentId: string;
  itemId: string;
  contentIndex: number;
  text: string;
  status: "live" | "final";
  revision: number;
  createdAt: number;
  updatedAt: number;
  finalizedAt: number | null;
  committedAt: number | null;
  speechStartedAt: number | null;
  speechStoppedAt: number | null;
}

export interface TranscriptStateSnapshot {
  liveSourceText: string;
  finalizedSegments: TranscriptSegment[];
  segments: TranscriptSegment[];
  activeSegmentId: string | null;
}

export interface TranscriptPerfSnapshot {
  micStartAt: number | null;
  realtimeConnectedAt: number | null;
  firstPartialTranscriptAt: number | null;
  firstFinalTranscriptAt: number | null;
  firstStableTriggerAt: number | null;
  firstTranslationRequestAt: number | null;
  firstTranslationDeltaAt: number | null;
  firstTranslationCompleteAt: number | null;
}

export interface RealtimeConnectionCallbacks {
  onSnapshot?: (snapshot: RealtimeConnectionSnapshot) => void;
  onEvent?: (event: RealtimeServerEvent) => void;
}

export interface RealtimeBrowserConnection {
  readonly snapshot: RealtimeConnectionSnapshot;
  disconnect: () => void;
}

export interface RealtimeControllerState {
  appStatus: TranslationAppStatus;
  connectionStatus: RealtimeConnectionStatus;
  micPermissionStatus: MicPermissionStatus;
  errorMessage: string | null;
  micAccessErrorName: string | null;
  micAccessErrorMessage: string | null;
  startAttemptCount: number;
  lastStartAttemptAt: number | null;
  lastStartBlockedByStatus: TranslationAppStatus | null;
  liveSourceText: string;
  finalizedSegments: TranscriptSegment[];
  liveTranslationText: string;
  liveTranslationSegmentId: string | null;
  translatedSegments: TranslatedSegment[];
  translationRequestState: TranslationRequestState;
  translationErrorMessage: string | null;
  activeTranslationTasks: TranslationTaskSummary[];
  recentRevisionCount: number;
  bubbles: TranslationBubble[];
  activeBubbleId: string | null;
  bubbleDebug: BubbleDebugSnapshot;
  sessionId: string | null;
  sessionExpiresAt: number | null;
  sessionModel: string | null;
  sessionTranscriptionLanguage: RealtimeTranscriptionLanguage | null;
  sessionTranscriptionPromptSummary: string | null;
  sessionTranscriptionLogprobsEnabled: boolean | null;
  sessionAudioRuntimeMode: AudioRuntimeMode | null;
  sessionTurnDetectionType: string | null;
  sessionSilenceDurationMs: number | null;
  badSessionAutoRecovered: boolean;
  peerConnectionState: RTCPeerConnectionState | "new";
  iceConnectionState: RTCIceConnectionState | "new";
  signalingState: RTCSignalingState | "stable";
  dataChannelState: RTCDataChannelState | "closed";
  lastRealtimeEventType: string | null;
  perfSnapshot: TranscriptPerfSnapshot;
  realtimeEventTimeline: RealtimeTimelineEntry[];
}
