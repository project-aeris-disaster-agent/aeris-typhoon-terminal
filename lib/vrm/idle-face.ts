import type { VRM } from "@pixiv/three-vrm";
import type { SpeechEmotion } from "@/lib/agent-speech/types";

/** Central tuning for avatar mouth + mood exaggeration. */
const TUNING = {
  speakingThreshold: 0.01,
  mouthGain: 1.4,
  mouthCurve: 0.8,
  viseme: { aa: 1, ih: 0.55, ou: 0.35, ee: 0.25, oh: 0.2 },
  emotionIdleScale: 0.6,
  emotionSpeakScale: 1.15,
  idleRelaxed: { speak: 0.14, base: 0.22, breatheAmp: 0.1 },
  idleHappy: { base: 0.06, swayAmp: 0.04 },
} as const;

const EMOTION_BLEND: Record<
  SpeechEmotion,
  { key: string; weight: number }[]
> = {
  assistant: [{ key: "relaxed", weight: 0.35 }],
  weather: [
    { key: "relaxed", weight: 0.18 },
    { key: "surprised", weight: 0.55 },
  ],
  urgent: [
    { key: "relaxed", weight: 0.12 },
    { key: "sad", weight: 0.5 },
  ],
};

const MANAGED_MOOD_KEYS = [
  "relaxed",
  "happy",
  "surprised",
  "sad",
  "angry",
] as const;

const VISEME_KEYS = ["aa", "ih", "ou", "ee", "oh"] as const;

export function isAvatarSpeaking(mouthLevel: number): boolean {
  return mouthLevel > TUNING.speakingThreshold;
}

/** Remap raw mouth level (0–1) for a more open, readable lip-sync. */
export function exaggerateMouthLevel(mouthLevel: number): number {
  const clamped = Math.max(0, Math.min(1, mouthLevel));
  return Math.min(
    1,
    Math.pow(clamped * TUNING.mouthGain, TUNING.mouthCurve),
  );
}

function setBlink(vrm: VRM, weight: number): void {
  const em = vrm.expressionManager;
  if (!em) return;

  if (em.getExpression("blink")) {
    em.setValue("blink", weight);
    return;
  }
  if (em.getExpression("blinkLeft") || em.getExpression("blinkRight")) {
    em.setValue("blinkLeft", weight);
    em.setValue("blinkRight", weight);
  }
}

function applyVisemes(vrm: VRM, mouth: number): void {
  const em = vrm.expressionManager;
  if (!em) return;

  for (const key of VISEME_KEYS) {
    const scale = TUNING.viseme[key];
    if (!em.getExpression(key)) continue;
    em.setValue(key, Math.min(1, mouth * scale));
  }
}

/**
 * Layered face: idle base mood, speech emotion boost, mouth visemes, blink.
 */
export function applyAvatarFace(
  vrm: VRM,
  mouthLevel: number,
  emotion: SpeechEmotion,
  elapsed: number,
  blinkWeight: number,
): void {
  const expressionManager = vrm.expressionManager;
  if (!expressionManager) return;

  for (const key of MANAGED_MOOD_KEYS) {
    if (expressionManager.getExpression(key)) {
      expressionManager.setValue(key, 0);
    }
  }

  const speaking = isAvatarSpeaking(mouthLevel);
  const mouth = exaggerateMouthLevel(mouthLevel);
  const breathe = 0.5 + 0.5 * Math.sin(elapsed * 1.1);

  if (expressionManager.getExpression("relaxed")) {
    const { speak, base, breatheAmp } = TUNING.idleRelaxed;
    const idleRelaxed = speaking ? speak : base + breathe * breatheAmp;
    expressionManager.setValue("relaxed", idleRelaxed);
  }

  if (expressionManager.getExpression("happy")) {
    const { base, swayAmp } = TUNING.idleHappy;
    const idleHappy = speaking ? 0 : base + Math.sin(elapsed * 0.65) * swayAmp;
    expressionManager.setValue("happy", idleHappy);
  }

  const emotionScale = speaking
    ? TUNING.emotionSpeakScale
    : TUNING.emotionIdleScale;

  for (const { key, weight } of EMOTION_BLEND[emotion]) {
    if (!expressionManager.getExpression(key)) continue;
    const boost = weight * emotionScale;
    const current = expressionManager.getValue(key) ?? 0;
    expressionManager.setValue(key, Math.min(1, current + boost));
  }

  applyVisemes(vrm, mouth);

  setBlink(vrm, blinkWeight);

  expressionManager.update();
}
