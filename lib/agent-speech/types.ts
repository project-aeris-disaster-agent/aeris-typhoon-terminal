export type SpeechEmotion = "assistant" | "weather" | "urgent";

export type SpeakableMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  source?: string;
  pending?: boolean;
};

export type AgentSpeechDriver = {
  /** Preload models/voices when the panel becomes active. */
  prepare?: () => Promise<void>;
  /** Human-readable status for UI (e.g. loading voice). */
  getStatus?: () => string | null;
  /** Active TTS backend label for UI (e.g. "Piper", "System voice"). */
  getEngineLabel?: () => string;
  speak: (
    text: string,
    emotion: SpeechEmotion,
    callbacks: {
      onStart?: () => void;
      onEnd?: () => void;
      onError?: (error: unknown) => void;
    },
  ) => Promise<void>;
  stop: () => void;
  /** Subscribe to mouth level updates (0–1). Returns unsubscribe. */
  subscribeMouthLevel: (listener: (level: number) => void) => () => void;
  dispose: () => void;
};

export type AgentTtsEngine = "web-speech" | "piper";

export const PIPER_FEMALE_VOICE_ID = "en_US-hfc_female-medium";

export function resolveAgentTtsEngine(): AgentTtsEngine {
  const raw = process.env.NEXT_PUBLIC_AGENT_TTS?.trim().toLowerCase();
  if (raw === "web-speech" || raw === "piper") return raw;
  return "piper";
}
