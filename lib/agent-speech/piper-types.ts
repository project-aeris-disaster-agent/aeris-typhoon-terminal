/** Minimal Piper browser module surface used by our driver. */
export type PiperModule = {
  download: (
    voiceId: string,
    callback?: (progress: { url: string; loaded: number; total: number }) => void,
  ) => Promise<void>;
  predict: (config: { text: string; voiceId: string }) => Promise<Blob>;
};
