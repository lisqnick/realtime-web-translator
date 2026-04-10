import type { ParsedRealtimeEvent, RealtimeServerEvent } from "@/types/realtime";

const TRANSCRIPT_DELTA_EVENT = "conversation.item.input_audio_transcription.delta";
const TRANSCRIPT_SEGMENT_EVENT = "conversation.item.input_audio_transcription.segment";
const TRANSCRIPT_COMPLETED_EVENT = "conversation.item.input_audio_transcription.completed";
const INPUT_AUDIO_BUFFER_SPEECH_STARTED_EVENT = "input_audio_buffer.speech_started";
const INPUT_AUDIO_BUFFER_SPEECH_STOPPED_EVENT = "input_audio_buffer.speech_stopped";
const INPUT_AUDIO_BUFFER_COMMITTED_EVENT = "input_audio_buffer.committed";

export function parseRealtimeEvent(event: RealtimeServerEvent): ParsedRealtimeEvent {
  const type = typeof event.type === "string" ? event.type : "unknown";

  if (type === INPUT_AUDIO_BUFFER_SPEECH_STARTED_EVENT) {
    return {
      kind: "input_audio_buffer_speech_started",
      type,
    };
  }

  if (type === INPUT_AUDIO_BUFFER_SPEECH_STOPPED_EVENT) {
    return {
      kind: "input_audio_buffer_speech_stopped",
      type,
    };
  }

  if (type === TRANSCRIPT_DELTA_EVENT) {
    const itemId = readItemId(event);
    const contentIndex = readContentIndex(event);
    const delta = readTranscriptText(event, ["delta", "text", "transcript"]);

    if (!itemId || contentIndex === null || delta === null) {
      return {
        kind: "invalid",
        type,
        reason: "delta event is missing item_id, content_index, or delta",
      };
    }

    return {
      kind: "transcript_delta",
      type,
      itemId,
      contentIndex,
      delta,
    };
  }

  if (type === TRANSCRIPT_COMPLETED_EVENT) {
    const itemId = readItemId(event);
    const contentIndex = readContentIndex(event);
    const transcript = readTranscriptText(event, ["transcript", "text", "delta"]);

    if (!itemId || contentIndex === null || transcript === null) {
      return {
        kind: "invalid",
        type,
        reason: "completed event is missing item_id, content_index, or transcript",
      };
    }

    return {
      kind: "transcript_completed",
      type,
      itemId,
      contentIndex,
      transcript,
    };
  }

  if (type === TRANSCRIPT_SEGMENT_EVENT) {
    const itemId = readItemId(event);
    const contentIndex = readContentIndex(event);
    const text = readTranscriptText(event, ["text", "transcript", "delta"]);

    if (!itemId || contentIndex === null || text === null) {
      return {
        kind: "invalid",
        type,
        reason: "segment event is missing item_id, content_index, or text",
      };
    }

    return {
      kind: "transcript_segment",
      type,
      itemId,
      contentIndex,
      text,
    };
  }

  if (type === INPUT_AUDIO_BUFFER_COMMITTED_EVENT) {
    const itemId = readItemId(event);
    const previousItemId = readOptionalString(event, "previous_item_id");

    if (!itemId) {
      return {
        kind: "invalid",
        type,
        reason: "input_audio_buffer.committed event is missing item_id",
      };
    }

    return {
      kind: "input_audio_buffer_committed",
      type,
      itemId,
      previousItemId,
    };
  }

  return {
    kind: "ignored",
    type,
  };
}

function readItemId(event: RealtimeServerEvent) {
  return readOptionalString(event, "item_id");
}

function readContentIndex(event: RealtimeServerEvent) {
  if (typeof event.content_index === "number") {
    return event.content_index;
  }

  return 0;
}

function readTranscriptText(
  event: RealtimeServerEvent,
  candidateKeys: Array<"delta" | "text" | "transcript">,
) {
  for (const key of candidateKeys) {
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
