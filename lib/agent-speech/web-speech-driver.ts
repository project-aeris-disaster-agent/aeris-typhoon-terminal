import {
  createEnvelopeController,
  createMouthLevelLoop,
} from "@/lib/agent-speech/audio-analyser";
import type { AgentSpeechDriver, SpeechEmotion } from "@/lib/agent-speech/types";

const FEMALE_VOICE_HINTS = [
  "zira",
  "samantha",
  "karen",
  "moira",
  "tessa",
  "fiona",
  "aria",
  "jenny",
  "female",
  "woman",
];

function pickEnglishVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  const english = voices.filter(
    (v) => v.lang.startsWith("en-US") || v.lang.startsWith("en-GB") || v.lang.startsWith("en"),
  );
  if (english.length === 0) return voices[0] ?? null;

  const female = english.find((v) =>
    FEMALE_VOICE_HINTS.some((hint) => v.name.toLowerCase().includes(hint)),
  );
  if (female) return female;

  const us = english.find((v) => v.lang.startsWith("en-US"));
  return us ?? english[0] ?? null;
}

export function createWebSpeechDriver(): AgentSpeechDriver {
  const listeners = new Set<(level: number) => void>();
  const envelope = createEnvelopeController();
  let stopMouthLoop: (() => void) | null = null;
  let currentUtterance: SpeechSynthesisUtterance | null = null;
  let voicesReady = false;

  const notify = (level: number) => {
    listeners.forEach((fn) => fn(level));
  };

  const ensureVoices = () =>
    new Promise<void>((resolve) => {
      if (voicesReady || typeof window === "undefined") {
        resolve();
        return;
      }
      const synth = window.speechSynthesis;
      const voices = synth.getVoices();
      if (voices.length > 0) {
        voicesReady = true;
        resolve();
        return;
      }
      const onVoices = () => {
        voicesReady = true;
        synth.removeEventListener("voiceschanged", onVoices);
        resolve();
      };
      synth.addEventListener("voiceschanged", onVoices);
      window.setTimeout(() => {
        synth.removeEventListener("voiceschanged", onVoices);
        voicesReady = true;
        resolve();
      }, 500);
    });

  const startMouthLoop = () => {
    stopMouthLoop?.();
    stopMouthLoop = createMouthLevelLoop(
      () => envelope.tick(),
      (level) => notify(level),
    );
  };

  return {
    async prepare() {
      await ensureVoices();
    },

    getEngineLabel() {
      return "System voice";
    },

    async speak(text, _emotion, callbacks) {
      if (typeof window === "undefined" || !window.speechSynthesis) {
        callbacks.onError?.(new Error("speechSynthesis unavailable"));
        return;
      }

      await ensureVoices();
      window.speechSynthesis.cancel();
      envelope.reset();

      const utterance = new SpeechSynthesisUtterance(text);
      currentUtterance = utterance;
      const voice = pickEnglishVoice();
      if (voice) utterance.voice = voice;
      utterance.rate = 1;
      utterance.pitch = 1;

      utterance.onstart = () => {
        startMouthLoop();
        envelope.pulse(0.7);
        callbacks.onStart?.();
      };

      utterance.onboundary = () => {
        envelope.pulse(1);
      };

      utterance.onend = () => {
        envelope.reset();
        notify(0);
        stopMouthLoop?.();
        stopMouthLoop = null;
        currentUtterance = null;
        callbacks.onEnd?.();
      };

      utterance.onerror = (event) => {
        envelope.reset();
        notify(0);
        stopMouthLoop?.();
        stopMouthLoop = null;
        currentUtterance = null;
        callbacks.onError?.(event);
      };

      window.speechSynthesis.speak(utterance);
    },

    stop() {
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      envelope.reset();
      notify(0);
      stopMouthLoop?.();
      stopMouthLoop = null;
      currentUtterance = null;
    },

    subscribeMouthLevel(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    dispose() {
      this.stop();
      listeners.clear();
    },
  };
}
