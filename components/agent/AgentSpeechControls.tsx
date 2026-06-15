"use client";

import { Volume2, VolumeX } from "lucide-react";

type AgentSpeechControlsProps = {
  muted: boolean;
  onToggleMute: () => void;
  voiceStatus?: string | null;
  voiceEngine?: string | null;
};

export function AgentSpeechControls({
  muted,
  onToggleMute,
  voiceStatus,
  voiceEngine,
}: AgentSpeechControlsProps) {
  return (
    <div className="absolute top-1.5 right-1.5 z-20 flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onToggleMute}
        aria-label={muted ? "Unmute Agent AERIS voice" : "Mute Agent AERIS voice"}
        aria-pressed={muted}
        className="rounded-md border border-aeris-border/60 bg-aeris-bg/80 p-1 text-aeris-muted transition-colors hover:border-aeris-accent/40 hover:text-aeris-accent"
      >
        {muted ? (
          <VolumeX className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <Volume2 className="h-3.5 w-3.5" aria-hidden />
        )}
      </button>
      {(voiceStatus || voiceEngine) && (
        <span className="max-w-[100px] truncate rounded bg-aeris-bg/90 px-1 py-0.5 text-chrome font-mono uppercase tracking-wider text-aeris-muted">
          {voiceStatus ?? voiceEngine}
        </span>
      )}
    </div>
  );
}
