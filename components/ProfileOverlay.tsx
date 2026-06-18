"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import dynamic from "next/dynamic";
import { clsx } from "clsx";
import { PanelSkeleton } from "@/components/ui/PanelSkeleton";

const ProfilePanel = dynamic(
  () => import("./panels/ProfilePanel").then((m) => ({ default: m.ProfilePanel })),
  { ssr: false, loading: PanelSkeleton },
);

export type ProfileOverlayProps = {
  open: boolean;
  onClose: () => void;
};

export function ProfileOverlay({ open, onClose }: ProfileOverlayProps) {
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragState = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  useEffect(() => {
    if (!open) setOffset({ x: 0, y: 0 });
  }, [open]);

  const handlePointerMove = useCallback((event: PointerEvent) => {
    const state = dragState.current;
    if (!state || event.pointerId !== state.pointerId) return;
    setOffset({
      x: state.originX + (event.clientX - state.startX),
      y: state.originY + (event.clientY - state.startY),
    });
  }, []);

  const endDrag = useCallback(() => {
    dragState.current = null;
    setDragging(false);
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", endDrag);
    window.removeEventListener("pointercancel", endDrag);
  }, [handlePointerMove]);

  useEffect(() => endDrag, [endDrag]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const handleDragStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if ((event.target as HTMLElement).closest("button")) return;
      event.preventDefault();
      dragState.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: offset.x,
        originY: offset.y,
      };
      setDragging(true);
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", endDrag);
      window.addEventListener("pointercancel", endDrag);
    },
    [offset.x, offset.y, handlePointerMove, endDrag],
  );

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="Profile"
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
      className={clsx(
        "fixed right-3 top-14 z-[60] w-[min(calc(100vw-1rem),360px)]",
        "h-[min(78vh,560px)] overflow-hidden rounded-md border border-aeris-border",
        "bg-aeris-surface/98 shadow-xl backdrop-blur-md",
        "flex flex-col pointer-events-auto",
      )}
    >
      <div
        onPointerDown={handleDragStart}
        className={clsx(
          "flex shrink-0 items-center justify-between gap-2 border-b border-aeris-border px-2 py-1.5 touch-none select-none",
          dragging ? "cursor-grabbing" : "cursor-grab",
        )}
      >
        <span className="hud-text text-body-sm text-aeris-muted font-mono">
          Profile
        </span>
        <button
          type="button"
          onClick={onClose}
          className="hud-text rounded px-2 py-0.5 text-aeris-muted hover:bg-aeris-bg hover:text-aeris-text"
          aria-label="Close profile"
        >
          ✕
        </button>
      </div>
      <div className="min-h-0 flex-1 bg-aeris-bg/80">
        <ProfilePanel />
      </div>
    </div>
  );
}
