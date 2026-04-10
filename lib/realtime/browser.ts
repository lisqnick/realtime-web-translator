import type {
  RealtimeBrowserConnection,
  RealtimeConnectionCallbacks,
  RealtimeConnectionSnapshot,
  RealtimeServerEvent,
  RealtimeSessionResponse,
} from "@/types/realtime";
import type { MicPermissionStatus } from "@/types/config";

const OPENAI_REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";
const REALTIME_CONNECTION_TIMEOUT_MS = 15_000;

export class RealtimeBrowserError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RealtimeBrowserError";
    this.code = code;
  }
}

export function assertRealtimeBrowserSupport() {
  if (typeof window === "undefined") {
    throw new RealtimeBrowserError(
      "browser_only",
      "Realtime 连接只能在浏览器环境中建立。",
    );
  }

  if (!window.RTCPeerConnection) {
    throw new RealtimeBrowserError(
      "unsupported_webrtc",
      "当前浏览器不支持 WebRTC，无法建立 Realtime 连接。",
    );
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    throw new RealtimeBrowserError(
      "unsupported_microphone",
      "当前浏览器不支持麦克风采集能力。",
    );
  }

  if (!window.isSecureContext) {
    throw new RealtimeBrowserError(
      "insecure_context",
      "当前页面不是安全上下文，麦克风只能在 localhost 或 HTTPS 页面中使用。",
    );
  }
}

export async function requestMicrophoneStream() {
  assertRealtimeBrowserSupport();

  return navigator.mediaDevices.getUserMedia({
    audio: true,
  });
}

export function describeMediaAccessError(error: unknown) {
  type MediaAccessErrorDescription = {
    message: string;
    micPermissionStatus: MicPermissionStatus;
  };

  if (!(error instanceof DOMException)) {
    return null;
  }

  switch (error.name) {
    case "NotAllowedError":
      return {
        message: window.isSecureContext
          ? "麦克风权限被拒绝，请在浏览器地址栏或站点设置中允许麦克风后重试。"
          : "当前页面不是安全上下文，麦克风只能在 localhost 或 HTTPS 页面中使用。",
        micPermissionStatus: window.isSecureContext ? "denied" : "error",
      } satisfies MediaAccessErrorDescription;
    case "NotFoundError":
      return {
        message: "没有检测到可用的麦克风设备，请确认设备已连接并被系统识别。",
        micPermissionStatus: "error",
      } satisfies MediaAccessErrorDescription;
    case "NotReadableError":
      return {
        message: "麦克风当前不可读，可能正被其他应用占用。请关闭占用后重试。",
        micPermissionStatus: "error",
      } satisfies MediaAccessErrorDescription;
    case "OverconstrainedError":
      return {
        message: "当前浏览器无法满足所请求的麦克风条件，请更换浏览器或设备后重试。",
        micPermissionStatus: "error",
      } satisfies MediaAccessErrorDescription;
    case "SecurityError":
      return {
        message: "浏览器安全策略阻止了麦克风访问，请确认当前站点为 localhost 或 HTTPS。",
        micPermissionStatus: "error",
      } satisfies MediaAccessErrorDescription;
    case "AbortError":
      return {
        message: "麦克风初始化被中断，请重新点击开始再试一次。",
        micPermissionStatus: "error",
      } satisfies MediaAccessErrorDescription;
    default:
      return {
        message: `麦克风初始化失败：${error.name}${error.message ? ` - ${error.message}` : ""}`,
        micPermissionStatus: "error",
      } satisfies MediaAccessErrorDescription;
  }
}

export async function connectRealtimeSession(options: {
  mediaStream: MediaStream;
  session: RealtimeSessionResponse;
  signal?: AbortSignal;
  callbacks?: RealtimeConnectionCallbacks;
}): Promise<RealtimeBrowserConnection> {
  assertRealtimeBrowserSupport();

  const peerConnection = new RTCPeerConnection();
  const dataChannel = peerConnection.createDataChannel("oai-events");

  const snapshot: RealtimeConnectionSnapshot = {
    connectionStatus: "connecting",
    peerConnectionState: peerConnection.connectionState,
    iceConnectionState: peerConnection.iceConnectionState,
    signalingState: peerConnection.signalingState,
    dataChannelState: dataChannel.readyState,
    sessionId: options.session.session.id,
    lastEventType: null,
  };

  const emitSnapshot = (patch?: Partial<RealtimeConnectionSnapshot>) => {
    const nextSnapshot = {
      ...snapshot,
      ...patch,
      peerConnectionState: peerConnection.connectionState,
      iceConnectionState: peerConnection.iceConnectionState,
      signalingState: peerConnection.signalingState,
      dataChannelState: dataChannel.readyState,
      sessionId: options.session.session.id,
    };

    Object.assign(snapshot, nextSnapshot);
    options.callbacks?.onSnapshot?.(nextSnapshot);
  };

  const handleDataMessage = (event: MessageEvent<string>) => {
    try {
      const parsed = JSON.parse(event.data) as RealtimeServerEvent;
      emitSnapshot({
        lastEventType: typeof parsed.type === "string" ? parsed.type : snapshot.lastEventType,
      });
      options.callbacks?.onEvent?.(parsed);
    } catch {
      emitSnapshot({
        lastEventType: "unparsed_message",
      });
      options.callbacks?.onEvent?.({
        type: "unparsed_message",
        raw: event.data,
      });
    }
  };

  dataChannel.addEventListener("open", () => {
    emitSnapshot({
      connectionStatus: "connected",
    });
  });

  dataChannel.addEventListener("close", () => {
    emitSnapshot({
      connectionStatus:
        snapshot.connectionStatus === "connected" ? "disconnected" : snapshot.connectionStatus,
    });
  });

  dataChannel.addEventListener("message", handleDataMessage);
  peerConnection.addEventListener("connectionstatechange", () => {
    if (peerConnection.connectionState === "failed") {
      emitSnapshot({
        connectionStatus: "error",
      });
      return;
    }

    if (peerConnection.connectionState === "connected") {
      emitSnapshot({
        connectionStatus: "connected",
      });
      return;
    }

    if (
      peerConnection.connectionState === "disconnected" ||
      peerConnection.connectionState === "closed"
    ) {
      emitSnapshot({
        connectionStatus: "disconnected",
      });
      return;
    }

    emitSnapshot();
  });

  peerConnection.addEventListener("iceconnectionstatechange", () => {
    emitSnapshot();
  });

  peerConnection.addEventListener("signalingstatechange", () => {
    emitSnapshot();
  });

  for (const track of options.mediaStream.getTracks()) {
    peerConnection.addTrack(track, options.mediaStream);
  }

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  const sdpResponse = await fetch(OPENAI_REALTIME_CALLS_URL, {
    method: "POST",
    body: offer.sdp,
    headers: {
      Authorization: `Bearer ${options.session.clientSecret.value}`,
      "Content-Type": "application/sdp",
    },
    signal: options.signal,
  });

  if (!sdpResponse.ok) {
    const errorBody = await sdpResponse.text().catch(() => "");
    disconnectRealtimeResources(peerConnection, dataChannel, options.mediaStream);
    throw new RealtimeBrowserError(
      "realtime_sdp_failed",
      errorBody || "OpenAI Realtime SDP 协商失败。",
    );
  }

  const answerSdp = await sdpResponse.text();
  await peerConnection.setRemoteDescription({
    type: "answer",
    sdp: answerSdp,
  });

  await waitForRealtimeConnection({
    peerConnection,
    dataChannel,
    signal: options.signal,
  });

  emitSnapshot({
    connectionStatus: "connected",
  });

  return {
    get snapshot() {
      return snapshot;
    },
    disconnect() {
      disconnectRealtimeResources(peerConnection, dataChannel, options.mediaStream);
      emitSnapshot({
        connectionStatus: "disconnected",
      });
    },
  };
}

async function waitForRealtimeConnection(options: {
  peerConnection: RTCPeerConnection;
  dataChannel: RTCDataChannel;
  signal?: AbortSignal;
}) {
  if (
    options.peerConnection.connectionState === "connected" ||
    options.dataChannel.readyState === "open"
  ) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(
        new RealtimeBrowserError(
          "realtime_connect_timeout",
          "Realtime 连接超时，请检查网络后重试。",
        ),
      );
    }, REALTIME_CONNECTION_TIMEOUT_MS);

    const onAbort = () => {
      cleanup();
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };

    const onStateChange = () => {
      if (
        options.peerConnection.connectionState === "connected" ||
        options.dataChannel.readyState === "open"
      ) {
        cleanup();
        resolve();
        return;
      }

      if (
        options.peerConnection.connectionState === "failed" ||
        options.peerConnection.connectionState === "closed"
      ) {
        cleanup();
        reject(
          new RealtimeBrowserError(
            "realtime_connection_failed",
            "Realtime 连接建立失败。",
          ),
        );
      }
    };

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      options.signal?.removeEventListener("abort", onAbort);
      options.peerConnection.removeEventListener("connectionstatechange", onStateChange);
      options.dataChannel.removeEventListener("open", onStateChange);
    };

    options.signal?.addEventListener("abort", onAbort);
    options.peerConnection.addEventListener("connectionstatechange", onStateChange);
    options.dataChannel.addEventListener("open", onStateChange);
  });
}

function disconnectRealtimeResources(
  peerConnection: RTCPeerConnection,
  dataChannel: RTCDataChannel,
  mediaStream: MediaStream,
) {
  try {
    dataChannel.close();
  } catch {
    // Ignore close errors during teardown.
  }

  for (const sender of peerConnection.getSenders()) {
    try {
      sender.track?.stop();
    } catch {
      // Ignore sender cleanup errors.
    }
  }

  for (const track of mediaStream.getTracks()) {
    try {
      track.stop();
    } catch {
      // Ignore track cleanup errors.
    }
  }

  try {
    peerConnection.close();
  } catch {
    // Ignore peer connection close errors.
  }
}
