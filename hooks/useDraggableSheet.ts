"use client";

import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";

const EASE_BEZIER = "cubic-bezier(0.32,0.72,0,1)";
const SNAP_DURATION = 300; // drag-release transitions (expand/collapse/snapBack/dismiss)

// programmatic close (e.g. switching between sheets). Exported so callers that
// trigger close() imperatively can lock out further toggles for exactly this long.
export const QUICK_CLOSE_DURATION = 160;

export type DraggableSheetHandle = {
  // Animates the sheet out (faster than a drag-release dismiss) and then calls onClose.
  // For callers that need to close a sheet programmatically — e.g. switching to a
  // different sheet — instead of it just vanishing when its mount condition flips.
  close: () => void;
};

// Multi-snap drag for bottom sheets: compact (45vh) ↔ expanded (90vh) ↔ dismissed.
// Shared by AngleGraph and PoseSettings so both sheets behave identically.
// Pass allowExpand: false for sheets whose content doesn't benefit from a taller
// state (e.g. PoseSettings) — the swipe-up snap point is disabled and only
// compact ↔ dismissed remain.
export function useDraggableSheet(
  sheetRef: RefObject<HTMLDivElement | null>,
  onClose: () => void,
  options?: { allowExpand?: boolean }
): DraggableSheetHandle {
  const allowExpand = options?.allowExpand ?? true;
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  const quickCloseRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;

    // CSS animation fill (animate-slide-up, fill-mode: both) sits above inline styles in the
    // cascade and would override every transform set by the drag handler. Remove the class once
    // the entrance animation finishes so inline style.transform takes full control.
    const onAnimEnd = () => sheet.classList.remove("animate-slide-up");
    sheet.addEventListener("animationend", onAnimEnd, { once: true });

    let snap: "compact" | "expanded" = "compact";
    let startY = 0, dragging = false, delta = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const recentMoves: { y: number; t: number }[] = [];

    const clearTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };

    const expand = () => {
      snap = "expanded";
      sheet.style.transition = `height ${SNAP_DURATION}ms ${EASE_BEZIER}`;
      sheet.style.height = "90vh";
      sheet.style.transform = "";
      timer = setTimeout(() => { sheet.style.transition = ""; }, SNAP_DURATION + 10);
    };

    const collapse = () => {
      snap = "compact";
      sheet.style.transition = `transform ${SNAP_DURATION}ms ${EASE_BEZIER}, height ${SNAP_DURATION}ms ${EASE_BEZIER}`;
      sheet.style.transform = "translateY(0)";
      sheet.style.height = "45vh";
      timer = setTimeout(() => {
        sheet.style.transition = "none";
        sheet.style.transform = "";
        void sheet.offsetHeight; // force reflow before re-enabling transition
        sheet.style.transition = "";
      }, SNAP_DURATION + 10);
    };

    const dismiss = (durationMs: number = SNAP_DURATION) => {
      // Remove entrance animation class so inline transform can take control immediately,
      // even if dismiss() is called while animate-slide-up is still running.
      sheet.classList.remove("animate-slide-up");
      sheet.style.transition = `transform ${durationMs}ms ${EASE_BEZIER}`;
      sheet.style.transform = "translateY(110%)";
      timer = setTimeout(() => {
        // The component unmounts right after this, so don't reset transform/transition —
        // doing so snaps the sheet back into view for a frame before React removes the
        // node, producing a visible flicker of the (still-expanded-height) panel.
        onCloseRef.current();
      }, durationMs);
    };

    const snapBack = () => {
      sheet.style.transition = `transform ${SNAP_DURATION}ms ${EASE_BEZIER}`;
      sheet.style.transform = "translateY(0)";
      timer = setTimeout(() => {
        sheet.style.transition = "none";
        sheet.style.transform = "";
        void sheet.offsetHeight; // force reflow before re-enabling transition
        sheet.style.transition = "";
      }, SNAP_DURATION + 10);
    };

    quickCloseRef.current = () => dismiss(QUICK_CLOSE_DURATION);

    const onTouchStart = (e: TouchEvent) => {
      const rect = sheet.getBoundingClientRect();
      if (e.touches[0].clientY - rect.top > 72) return;
      clearTimer();
      startY = e.touches[0].clientY;
      delta = 0;
      dragging = true;
      recentMoves.length = 0;
      sheet.style.transition = "none";
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!dragging) return;
      const y = e.touches[0].clientY;
      delta = y - startY;
      const now = Date.now();
      recentMoves.push({ y, t: now });
      // keep only the last 100 ms so velocity reflects the final motion, not the whole swipe
      while (recentMoves.length > 1 && now - recentMoves[0].t > 100) recentMoves.shift();
      // Only translate downward; upward drag shows no interim visual (snap on release)
      sheet.style.transform = delta > 0 ? `translateY(${delta}px)` : "translateY(0)";
    };

    const onRelease = () => {
      if (!dragging) return;
      dragging = false;
      // velocity in px/ms from the last 100 ms window — positive = downward
      const vel = recentMoves.length >= 2
        ? (recentMoves[recentMoves.length - 1].y - recentMoves[0].y) /
          (recentMoves[recentMoves.length - 1].t - recentMoves[0].t)
        : 0;

      if (snap === "compact") {
        if (allowExpand && (delta < -40 || vel < -0.3)) {
          expand();
        } else if (delta > 80 || vel > 0.3) {
          dismiss();
        } else {
          snapBack();
        }
      } else {
        // expanded — dismiss only when still moving fast at the moment of release;
        // a decelerated swipe (started fast, braked) collapses to 45 vh instead
        if ((delta > 150 && vel > 0.3) || vel > 0.5) {
          dismiss();
        } else if (delta > 60 || vel > 0.3) {
          collapse();
        } else {
          snapBack();
        }
      }
    };

    const onTouchCancel = () => {
      if (!dragging) return;
      dragging = false;
      sheet.style.transform = "";
      sheet.style.transition = "";
    };

    sheet.addEventListener("touchstart", onTouchStart, { passive: true });
    sheet.addEventListener("touchmove", onTouchMove, { passive: true });
    sheet.addEventListener("touchend", onRelease, { passive: true });
    sheet.addEventListener("touchcancel", onTouchCancel, { passive: true });

    return () => {
      sheet.removeEventListener("animationend", onAnimEnd);
      sheet.removeEventListener("touchstart", onTouchStart);
      sheet.removeEventListener("touchmove", onTouchMove);
      sheet.removeEventListener("touchend", onRelease);
      sheet.removeEventListener("touchcancel", onTouchCancel);
      clearTimer();
      quickCloseRef.current = null;
    };
  }, [sheetRef, allowExpand]);

  const close = useCallback(() => {
    quickCloseRef.current?.();
  }, []);

  return useMemo(() => ({ close }), [close]);
}
