"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createAgentSpeechDriver } from "@/lib/agent-speech/create-driver";
import type { AgentSpeechDriver } from "@/lib/agent-speech/types";
import { emotionForMessage, isSpeakEligible } from "@/lib/agent-speech/eligibility";
import { sanitizeForSpeech } from "@/lib/agent-speech/sanitize";
import type { SpeakableMessage, SpeechEmotion } from "@/lib/agent-speech/types";

type UseAgentSpeechOptions = {
  messages: SpeakableMessage[];
  isActive: boolean;
  muted: boolean;
  /** IDs from DB history (and placeholders) to mark spoken without audio. */
  seededMessageIds: Set<string> | null;
};

export function useAgentSpeech({
  messages,
  isActive,
  muted,
  seededMessageIds,
}: UseAgentSpeechOptions) {
  const [mouthLevel, setMouthLevel] = useState(0);
  const [emotion, setEmotion] = useState<SpeechEmotion>("assistant");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [driverReady, setDriverReady] = useState(false);

  const spokenIdsRef = useRef(new Set<string>());
  const historySeededRef = useRef(false);
  const driverRef = useRef<AgentSpeechDriver | null>(null);

  useEffect(() => {
    let disposed = false;
    let unsub: (() => void) | undefined;

    void createAgentSpeechDriver().then((driver) => {
      if (disposed) {
        driver.dispose();
        return;
      }
      driverRef.current = driver;
      setDriverReady(true);
      unsub = driver.subscribeMouthLevel(setMouthLevel);

      if (driver.prepare) {
        void driver.prepare();
      }
    });

    return () => {
      disposed = true;
      unsub?.();
      driverRef.current?.dispose();
      driverRef.current = null;
      setDriverReady(false);
    };
  }, [isActive]);

  useEffect(() => {
    if (!seededMessageIds || historySeededRef.current) return;
    seededMessageIds.forEach((id) => spokenIdsRef.current.add(id));
    historySeededRef.current = true;
  }, [seededMessageIds]);

  const speakMessage = useCallback(
    async (message: SpeakableMessage) => {
      const driver = driverRef.current;
      if (!driver || muted) return;

      const text = sanitizeForSpeech(message.content);
      if (!text) return;

      const msgEmotion = emotionForMessage(message);
      setEmotion(msgEmotion);
      setIsSpeaking(true);

      await driver.speak(text, msgEmotion, {
        onStart: () => setIsSpeaking(true),
        onEnd: () => {
          setIsSpeaking(false);
          setMouthLevel(0);
        },
        onError: () => {
          setIsSpeaking(false);
          setMouthLevel(0);
        },
      });
    },
    [muted],
  );

  useEffect(() => {
    if (!isActive || muted || !historySeededRef.current || !driverReady) return;

    const pending = messages.filter(
      (m) => isSpeakEligible(m) && !spokenIdsRef.current.has(m.id),
    );
    if (pending.length === 0) return;

    pending.forEach((m) => spokenIdsRef.current.add(m.id));
    const latest = pending[pending.length - 1];
    void speakMessage(latest);
  }, [messages, isActive, muted, seededMessageIds, driverReady, speakMessage]);

  useEffect(() => {
    if (!muted) return;
    driverRef.current?.stop();
    setIsSpeaking(false);
    setMouthLevel(0);
  }, [muted]);

  return {
    mouthLevel,
    emotion,
    isSpeaking,
  };
}
