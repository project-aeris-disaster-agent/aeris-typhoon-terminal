"use client";

import { useState } from "react";
import { CardHeader, Pill } from "../ui/Card";
import { LIVE_CAMS, type LiveCam } from "@/config/livecams";

export function LiveCamPanel() {
  const [active, setActive] = useState<LiveCam>(LIVE_CAMS[0]);

  return (
    <div className="space-y-2">
      <CardHeader
        title="Live Streams"
        trailing={<Pill tone="danger">LIVE</Pill>}
      />

      <select
        value={active.id}
        onChange={(e) => {
          const next = LIVE_CAMS.find((c) => c.id === e.target.value);
          if (next) setActive(next);
        }}
        className="w-full bg-aeris-bg border border-aeris-border rounded px-2 py-1 text-xs"
      >
        {LIVE_CAMS.map((c) => (
          <option key={c.id} value={c.id}>
            {c.region} · {c.label}
          </option>
        ))}
      </select>

      <div className="aspect-video bg-black rounded overflow-hidden border border-aeris-border">
        <iframe
          key={active.id}
          src={active.embedUrl}
          title={active.label}
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
          className="w-full h-full"
        />
      </div>

      <div className="text-[10px] text-aeris-muted">
        Source: {active.provider}. Availability depends on broadcaster.
      </div>
    </div>
  );
}
