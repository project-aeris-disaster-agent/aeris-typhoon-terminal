import {
  computeRmsLevel,
  createMouthLevelLoop,
} from "@/lib/agent-speech/audio-analyser";
import type { PiperModule } from "@/lib/agent-speech/piper-types";
import type { AgentSpeechDriver } from "@/lib/agent-speech/types";
import { PIPER_FEMALE_VOICE_ID } from "@/lib/agent-speech/types";

const PIPER_VENDOR_URL = "/vendor/piper/piper-tts-web.js";

let piperModulePromise: Promise<PiperModule> | null = null;

function loadPiperModule(): Promise<PiperModule> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Piper TTS is browser-only"));
  }
  if (!piperModulePromise) {
    const url = `${window.location.origin}${PIPER_VENDOR_URL}`;
    piperModulePromise = import(/* webpackIgnore: true */ url).then(
      (mod) => mod as PiperModule,
    );
  }
  return piperModulePromise;
}

export function createPiperSpeechDriver(): AgentSpeechDriver {
  const listeners = new Set<(level: number) => void>();
  let prepared = false;
  let status: string | null = "Loading voice…";
  let stopMouthLoop: (() => void) | null = null;
  let audioContext: AudioContext | null = null;
  let sourceNode: AudioBufferSourceNode | null = null;
  let analyser: AnalyserNode | null = null;
  let timeData: Uint8Array | null = null;
  let currentLevel = 0;

  const notify = (level: number) => {
    currentLevel = level;
    listeners.forEach((fn) => fn(level));
  };

  const ensureAudioGraph = () => {
    if (!audioContext) {
      audioContext = new AudioContext();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.35;
      analyser.connect(audioContext.destination);
      timeData = new Uint8Array(analyser.fftSize);
    }
    return { ctx: audioContext, analyser: analyser!, timeData: timeData! };
  };

  const startAnalyserLoop = () => {
    stopMouthLoop?.();
    if (!analyser || !timeData) return;
    stopMouthLoop = createMouthLevelLoop(
      () => computeRmsLevel(analyser!, timeData!),
      (level) => notify(level),
      { decay: 0.75 },
    );
  };

  const stopPlayback = () => {
    try {
      sourceNode?.stop();
    } catch {
      /* already stopped */
    }
    sourceNode = null;
    notify(0);
    stopMouthLoop?.();
    stopMouthLoop = null;
  };

  const updateDownloadStatus = (loaded: number, total: number) => {
    if (total > 0) {
      status = `Loading voice ${Math.round((loaded / total) * 100)}%`;
      return;
    }
    status = "Loading voice…";
  };

  return {
    async prepare() {
      if (prepared) return;
      status = "Loading voice…";
      const tts = await loadPiperModule();
      await tts.download(PIPER_FEMALE_VOICE_ID, ({ loaded, total }) => {
        updateDownloadStatus(loaded, total);
      });
      prepared = true;
      status = null;
    },

    getStatus() {
      return status;
    },

    getEngineLabel() {
      return "Piper";
    },

    async speak(text, _emotion, callbacks) {
      stopPlayback();

      try {
        const tts = await loadPiperModule();
        if (!prepared) await this.prepare?.();

        const wavBlob = await tts.predict({
          text,
          voiceId: PIPER_FEMALE_VOICE_ID,
        });

        const { ctx, analyser: an, timeData: td } = ensureAudioGraph();
        if (ctx.state === "suspended") await ctx.resume();

        const arrayBuffer = await wavBlob.arrayBuffer();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));

        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(an);
        sourceNode = source;

        startAnalyserLoop();
        callbacks.onStart?.();

        await new Promise<void>((resolve) => {
          source.onended = () => resolve();
          source.start(0);
        });

        stopPlayback();
        callbacks.onEnd?.();
      } catch (error) {
        stopPlayback();
        callbacks.onError?.(error);
      }
    },

    stop() {
      stopPlayback();
    },

    subscribeMouthLevel(listener) {
      listeners.add(listener);
      listener(currentLevel);
      return () => listeners.delete(listener);
    },

    dispose() {
      this.stop();
      void audioContext?.close();
      audioContext = null;
      analyser = null;
      timeData = null;
      listeners.clear();
    },
  };
}
