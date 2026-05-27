import { isPlaceholderSpeechContent } from "@/lib/agent-speech/sanitize";
import type { SpeakableMessage, SpeechEmotion } from "@/lib/agent-speech/types";

export function isSpeakEligible(message: SpeakableMessage): boolean {
  if (message.pending) return false;
  if (!message.content.trim()) return false;
  if (isPlaceholderSpeechContent(message.content)) return false;

  if (message.role === "user") return false;
  if (message.source === "operator" || message.source === "user") return false;

  if (message.role === "assistant") {
    return message.source === "assistant" || message.source === undefined;
  }

  if (message.role === "system") {
    return message.source === "system" || message.source === "weather_report";
  }

  return false;
}

export function emotionForMessage(message: SpeakableMessage): SpeechEmotion {
  if (message.source === "weather_report") return "weather";
  if (message.role === "system") return "urgent";
  return "assistant";
}
