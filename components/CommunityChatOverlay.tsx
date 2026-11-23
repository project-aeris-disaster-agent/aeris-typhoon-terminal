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
import { X } from "lucide-react";
import { PanelSkeleton } from "@/components/ui/PanelSkeleton";

const CommunityChatRoom = dynamic(
  () =>
    import("./panels/CommunityChatRoom").then((m) => ({
      default: m.CommunityChatRoom,
    })),
  { ssr: false, loading: PanelSkeleton },
);

export type CommunityChatOverlayProps = {
  open: boolean;
  onClose: () => void;
};

export function CommunityChatOverlay({
  open,
  onClose,
}: CommunityChatOverlayProps) {
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragState = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  // Reset position each time the panel is reopened.
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

  const handleDragStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      // Ignore drags that start on interactive controls (e.g. close button).
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
      aria-label="Community chat"
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
      className={clsx(
        "absolute left-3 bottom-3 z-50 w-[min(calc(100vw-1rem),380px)]",
        "h-[min(60vh,480px)] overflow-hidden rounded-xl",
        "panel-glass !shadow-pop aeris-rise",
        "flex flex-col pointer-events-auto",
      )}
    >
      <div
        onPointerDown={handleDragStart}
        className={clsx(
          "flex shrink-0 items-center justify-between gap-2 border-b border-aeris-border/70 px-3 py-2 touch-none select-none",
          dragging ? "cursor-grabbing" : "cursor-grab",
        )}
      >
        <span className="aeris-kicker"><span className="aeris-live-dot" aria-hidden />Community chat · #global</span>
        <button
          type="button"
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-aeris-elev text-aeris-ink2 transition-colors hover:text-aeris-danger"
          aria-label="Close community chat"
        >
          <X size={14} aria-hidden />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <CommunityChatRoom isActive={open} />
      </div>
    </div>
  );
}
