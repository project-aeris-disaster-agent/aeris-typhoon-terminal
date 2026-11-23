"use client";

import { Volume2, VolumeX } from "lucide-react";

type AgentSpeechControlsProps = {
  muted: boolean;
  onToggleMute: () => void;
};

export function AgentSpeechControls({
  muted,
  onToggleMute,
}: AgentSpeechControlsProps) {
  return (
    <div className="absolute top-1.5 right-1.5 z-20">
      <button
        type="button"
        onClick={onToggleMute}
        aria-label={muted ? "Unmute Agent AERIS voice" : "Mute Agent AERIS voice"}
        aria-pressed={muted}
        className="aeris-round !h-7 !min-w-7 !px-0"
      >
        {muted ? (
          <VolumeX className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <Volume2 className="h-3.5 w-3.5" aria-hidden />
        )}
      </button>
    </div>
  );
}
