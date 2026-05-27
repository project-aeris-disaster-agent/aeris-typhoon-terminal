import { createWebSpeechDriver } from "@/lib/agent-speech/web-speech-driver";
import type { AgentSpeechDriver, AgentTtsEngine } from "@/lib/agent-speech/types";
import { resolveAgentTtsEngine } from "@/lib/agent-speech/types";

function speakWithCallbacks(
  driver: AgentSpeechDriver,
  text: string,
  emotion: Parameters<AgentSpeechDriver["speak"]>[1],
  callbacks: Parameters<AgentSpeechDriver["speak"]>[2],
): Promise<void> {
  return new Promise((resolve, reject) => {
    void driver.speak(text, emotion, {
      onStart: callbacks.onStart,
      onEnd: () => {
        callbacks.onEnd?.();
        resolve();
      },
      onError: (error) => {
        callbacks.onError?.(error);
        reject(error);
      },
    });
  });
}

function withSpeakFallback(
  primary: AgentSpeechDriver,
  fallback: AgentSpeechDriver,
): AgentSpeechDriver {
  return {
    prepare: async () => {
      await primary.prepare?.();
    },
    getStatus: () => primary.getStatus?.() ?? null,
    getEngineLabel: () => primary.getEngineLabel?.() ?? "Piper",
    speak: async (text, emotion, callbacks) => {
      try {
        await speakWithCallbacks(primary, text, emotion, callbacks);
      } catch (error) {
        console.warn("Piper speak failed, using Web Speech", error);
        await speakWithCallbacks(fallback, text, emotion, callbacks);
      }
    },
    stop: () => {
      primary.stop();
      fallback.stop();
    },
    subscribeMouthLevel: (listener) => primary.subscribeMouthLevel(listener),
    dispose: () => {
      primary.dispose();
      fallback.dispose();
    },
  };
}

async function createPiperDriverWithFallback(): Promise<AgentSpeechDriver> {
  const { createPiperSpeechDriver } = await import(
    "@/lib/agent-speech/piper-speech-driver"
  );
  const piper = createPiperSpeechDriver();
  try {
    await piper.prepare?.();
    return withSpeakFallback(piper, createWebSpeechDriver());
  } catch (error) {
    piper.dispose();
    console.warn("Piper TTS unavailable, falling back to Web Speech", error);
    return createWebSpeechDriver();
  }
}

export async function createAgentSpeechDriver(
  engine: AgentTtsEngine = resolveAgentTtsEngine(),
): Promise<AgentSpeechDriver> {
  if (engine === "piper") {
    return createPiperDriverWithFallback();
  }
  return createWebSpeechDriver();
}
