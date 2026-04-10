import type {
  ParsedRealtimeEvent,
  TranscriptSegment,
  TranscriptStateSnapshot,
} from "@/types/realtime";

interface InternalTranscriptState {
  liveSegments: Map<string, TranscriptSegment>;
  finalizedSegments: Map<string, TranscriptSegment>;
  orderedItemIds: string[];
  itemCommittedAt: Map<string, number>;
  itemSpeechStartedAt: Map<string, number>;
  itemSpeechStoppedAt: Map<string, number>;
  pendingSpeechStartedAt: number | null;
  pendingSpeechStoppedAt: number | null;
}

export interface TranscriptBuffer {
  snapshot: TranscriptStateSnapshot;
  applyEvent: (event: ParsedRealtimeEvent, timestamp?: number) => TranscriptStateSnapshot;
  clearLive: () => TranscriptStateSnapshot;
  reset: () => TranscriptStateSnapshot;
}

export function createTranscriptBuffer(): TranscriptBuffer {
  let state = createEmptyInternalState();

  const getSnapshot = (): TranscriptStateSnapshot => {
    const orderedSegments = getOrderedCombinedSegments(state);
    const activeSegment = orderedSegments.filter((segment) => segment.status === "live").at(-1);

    return {
      liveSourceText: activeSegment?.text ?? "",
      finalizedSegments: orderedSegments.filter(
        (segment) => segment.status === "final" && segment.text.trim().length > 0,
      ),
      segments: orderedSegments,
      activeSegmentId: activeSegment?.segmentId ?? null,
    };
  };

  return {
    get snapshot() {
      return getSnapshot();
    },
    applyEvent(event, timestamp = Date.now()) {
      state = applyParsedRealtimeEvent(state, event, timestamp);
      return getSnapshot();
    },
    clearLive() {
      state = {
        ...state,
        liveSegments: new Map(),
      };
      return getSnapshot();
    },
    reset() {
      state = createEmptyInternalState();
      return getSnapshot();
    },
  };
}

function createEmptyInternalState(): InternalTranscriptState {
  return {
    liveSegments: new Map(),
    finalizedSegments: new Map(),
    orderedItemIds: [],
    itemCommittedAt: new Map(),
    itemSpeechStartedAt: new Map(),
    itemSpeechStoppedAt: new Map(),
    pendingSpeechStartedAt: null,
    pendingSpeechStoppedAt: null,
  };
}

function applyParsedRealtimeEvent(
  state: InternalTranscriptState,
  event: ParsedRealtimeEvent,
  timestamp: number,
) {
  if (event.kind === "ignored" || event.kind === "invalid") {
    return state;
  }

  if (event.kind === "input_audio_buffer_speech_started") {
    state.pendingSpeechStartedAt = timestamp;
    state.pendingSpeechStoppedAt = null;
    return state;
  }

  if (event.kind === "input_audio_buffer_speech_stopped") {
    state.pendingSpeechStoppedAt = timestamp;
    return state;
  }

  if (event.kind === "input_audio_buffer_committed") {
    ensureOrderedItemId(state, event.itemId, event.previousItemId);
    state.itemCommittedAt.set(event.itemId, timestamp);

    if (state.pendingSpeechStartedAt !== null) {
      state.itemSpeechStartedAt.set(event.itemId, state.pendingSpeechStartedAt);
    }

    if (state.pendingSpeechStoppedAt !== null) {
      state.itemSpeechStoppedAt.set(event.itemId, state.pendingSpeechStoppedAt);
    }

    updateCommittedTimestamp(state.liveSegments, event.itemId, timestamp);
    updateCommittedTimestamp(state.finalizedSegments, event.itemId, timestamp);
    updateSpeechBoundaryTimestamps(
      state.liveSegments,
      event.itemId,
      state.itemSpeechStartedAt.get(event.itemId) ?? null,
      state.itemSpeechStoppedAt.get(event.itemId) ?? null,
    );
    updateSpeechBoundaryTimestamps(
      state.finalizedSegments,
      event.itemId,
      state.itemSpeechStartedAt.get(event.itemId) ?? null,
      state.itemSpeechStoppedAt.get(event.itemId) ?? null,
    );
    state.pendingSpeechStartedAt = null;
    state.pendingSpeechStoppedAt = null;

    return state;
  }

  const segmentId = `${event.itemId}:${event.contentIndex}`;
  ensureOrderedItemId(state, event.itemId, null);

  if (event.kind === "transcript_segment") {
    return state;
  }

  if (event.kind === "transcript_delta") {
    const previousSegment =
      state.liveSegments.get(segmentId) ?? state.finalizedSegments.get(segmentId) ?? null;
    const nextText = mergeTranscriptDelta(previousSegment?.text ?? "", event.delta);
    const nextSegment: TranscriptSegment = {
      segmentId,
      itemId: event.itemId,
      contentIndex: event.contentIndex,
      text: nextText,
      status: "live",
      revision: (previousSegment?.revision ?? 0) + 1,
      createdAt: previousSegment?.createdAt ?? timestamp,
      updatedAt: timestamp,
      finalizedAt: null,
      committedAt:
        previousSegment?.committedAt ?? state.itemCommittedAt.get(event.itemId) ?? null,
      speechStartedAt:
        previousSegment?.speechStartedAt ??
        state.itemSpeechStartedAt.get(event.itemId) ??
        state.pendingSpeechStartedAt,
      speechStoppedAt:
        previousSegment?.speechStoppedAt ??
        state.itemSpeechStoppedAt.get(event.itemId) ??
        state.pendingSpeechStoppedAt,
    };

    state.liveSegments.set(segmentId, nextSegment);
    return state;
  }

  const previousSegment =
    state.liveSegments.get(segmentId) ?? state.finalizedSegments.get(segmentId) ?? null;
  const nextSegment: TranscriptSegment = {
    segmentId,
    itemId: event.itemId,
    contentIndex: event.contentIndex,
    text: event.transcript,
    status: "final",
    revision: (previousSegment?.revision ?? 0) + 1,
    createdAt: previousSegment?.createdAt ?? timestamp,
    updatedAt: timestamp,
    finalizedAt: timestamp,
    committedAt: previousSegment?.committedAt ?? state.itemCommittedAt.get(event.itemId) ?? null,
    speechStartedAt:
      previousSegment?.speechStartedAt ??
      state.itemSpeechStartedAt.get(event.itemId) ??
      state.pendingSpeechStartedAt,
    speechStoppedAt:
      previousSegment?.speechStoppedAt ??
      state.itemSpeechStoppedAt.get(event.itemId) ??
      state.pendingSpeechStoppedAt,
  };

  state.liveSegments.delete(segmentId);
  state.finalizedSegments.set(segmentId, nextSegment);
  return state;
}

function updateCommittedTimestamp(
  segmentMap: Map<string, TranscriptSegment>,
  itemId: string,
  committedAt: number,
) {
  for (const [segmentId, segment] of segmentMap.entries()) {
    if (segment.itemId !== itemId) {
      continue;
    }

    segmentMap.set(segmentId, {
      ...segment,
      committedAt,
    });
  }
}

function updateSpeechBoundaryTimestamps(
  segmentMap: Map<string, TranscriptSegment>,
  itemId: string,
  speechStartedAt: number | null,
  speechStoppedAt: number | null,
) {
  for (const [segmentId, segment] of segmentMap.entries()) {
    if (segment.itemId !== itemId) {
      continue;
    }

    segmentMap.set(segmentId, {
      ...segment,
      speechStartedAt: speechStartedAt ?? segment.speechStartedAt,
      speechStoppedAt: speechStoppedAt ?? segment.speechStoppedAt,
    });
  }
}

function mergeTranscriptDelta(currentText: string, delta: string) {
  if (!currentText) {
    return delta;
  }

  if (delta.startsWith(currentText) || delta.includes(currentText)) {
    return delta;
  }

  if (currentText.startsWith(delta)) {
    return currentText;
  }

  return `${currentText}${delta}`;
}

function ensureOrderedItemId(
  state: InternalTranscriptState,
  itemId: string,
  previousItemId: string | null,
) {
  const existingIndex = state.orderedItemIds.indexOf(itemId);

  if (existingIndex >= 0) {
    return;
  }

  if (!previousItemId) {
    state.orderedItemIds.push(itemId);
    return;
  }

  const previousIndex = state.orderedItemIds.indexOf(previousItemId);

  if (previousIndex === -1) {
    state.orderedItemIds.push(itemId);
    return;
  }

  state.orderedItemIds.splice(previousIndex + 1, 0, itemId);
}

function getOrderedCombinedSegments(state: InternalTranscriptState) {
  const combinedSegments = new Map<string, TranscriptSegment>();

  for (const [segmentId, segment] of state.finalizedSegments.entries()) {
    combinedSegments.set(segmentId, segment);
  }

  for (const [segmentId, segment] of state.liveSegments.entries()) {
    combinedSegments.set(segmentId, segment);
  }

  return getOrderedSegments(state, combinedSegments);
}

function getOrderedSegments(
  state: InternalTranscriptState,
  segmentMap: Map<string, TranscriptSegment>,
) {
  const orderedSegments: TranscriptSegment[] = [];
  const seenSegmentIds = new Set<string>();

  for (const itemId of state.orderedItemIds) {
    const matchingSegments = [...segmentMap.values()]
      .filter((segment) => segment.itemId === itemId)
      .sort((left, right) => left.contentIndex - right.contentIndex);

    for (const segment of matchingSegments) {
      orderedSegments.push(segment);
      seenSegmentIds.add(segment.segmentId);
    }
  }

  const remainingSegments = [...segmentMap.values()]
    .filter((segment) => !seenSegmentIds.has(segment.segmentId))
    .sort((left, right) => left.createdAt - right.createdAt);

  return [...orderedSegments, ...remainingSegments];
}
