import type {
  RealtimeServerEvent,
  RealtimeTimelineEntry,
  RealtimeTimelineEventType,
} from "@/types/realtime";

const TRACKED_TIMELINE_EVENT_TYPES = new Set<RealtimeTimelineEventType>([
  "input_audio_buffer.speech_started",
  "input_audio_buffer.speech_stopped",
  "input_audio_buffer.committed",
  "conversation.item.input_audio_transcription.delta",
  "conversation.item.input_audio_transcription.completed",
]);

const MAX_TIMELINE_ENTRIES = 24;

export function createRealtimeTimelineEntry(
  event: RealtimeServerEvent,
  options?: {
    micStartAt?: number | null;
    timestamp?: number;
  },
): RealtimeTimelineEntry | null {
  const eventType = typeof event.type === "string" ? event.type : null;

  if (!eventType || !TRACKED_TIMELINE_EVENT_TYPES.has(eventType as RealtimeTimelineEventType)) {
    return null;
  }

  const arrivedAt = options?.timestamp ?? Date.now();
  const micStartAt = options?.micStartAt ?? null;

  return {
    eventType: eventType as RealtimeTimelineEventType,
    itemId: readOptionalString(event, "item_id"),
    contentIndex: typeof event.content_index === "number" ? event.content_index : null,
    arrivedAt,
    elapsedMsFromMicStart: micStartAt === null ? null : arrivedAt - micStartAt,
    textLength: readTimelineTextLength(eventType as RealtimeTimelineEventType, event),
  };
}

export function appendRealtimeTimelineEntry(
  currentEntries: RealtimeTimelineEntry[],
  nextEntry: RealtimeTimelineEntry,
) {
  const nextEntries =
    nextEntry.eventType === "input_audio_buffer.speech_started"
      ? [nextEntry]
      : [...currentEntries, nextEntry];

  return nextEntries.slice(-MAX_TIMELINE_ENTRIES);
}

function readTimelineTextLength(
  eventType: RealtimeTimelineEventType,
  event: RealtimeServerEvent,
) {
  if (eventType === "conversation.item.input_audio_transcription.delta") {
    const delta = readFirstString(event, ["delta", "text", "transcript"]);
    return delta === null ? null : delta.length;
  }

  if (eventType === "conversation.item.input_audio_transcription.completed") {
    const transcript = readFirstString(event, ["transcript", "text", "delta"]);
    return transcript === null ? null : transcript.length;
  }

  return null;
}

function readFirstString(
  event: RealtimeServerEvent,
  keys: Array<"delta" | "text" | "transcript">,
) {
  for (const key of keys) {
    const value = event[key];

    if (typeof value === "string") {
      return value;
    }
  }

  return null;
}

function readOptionalString(event: RealtimeServerEvent, key: string) {
  const value = event[key];
  return typeof value === "string" ? value : null;
}
