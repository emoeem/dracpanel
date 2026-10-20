/**
 * Swipe gestures for the mobile navigation drawer.
 *
 * Touch handlers are attached to the app shell: a swipe in from the start edge
 * opens the drawer, and a swipe back closes it. The drawer is dragged live
 * (inline transform) so the gesture feels attached to the finger, then the
 * inline styles are dropped and the CSS classes take over again.
 */

import { useMemo, useRef, type RefObject, type TouchEvent } from "react";

import { useLatestRef } from "./useLatest";

/** How far from the screen edge an open gesture may start. */
const EDGE_ZONE_PX = 28;

/** Movement before a gesture commits to horizontal. */
const DIRECTION_SLOP_PX = 8;

/** Fraction of the drawer width that counts as "the user meant it". */
const COMMIT_RATIO = 0.3;

/** Flick speed in px/ms that commits even a short drag. */
const FLICK_SPEED = 0.4;

export interface DrawerGestureOptions {
  open: boolean;
  /** Only in drawer layout; on wide screens the sidebar is always visible. */
  enabled: boolean;
  drawerRef: RefObject<HTMLElement | null>;
  onOpenChange: (open: boolean) => void;
}

interface Gesture {
  startX: number;
  startY: number;
  at: number;
  rtl: boolean;
  open: boolean;
  width: number;
  dragging: boolean;
  toward: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Whether the drawer should end up open. `toward` is the drag distance along
 * the opening direction (negative means the user is pulling it closed).
 */
export function resolveGesture(gesture: {
  open: boolean;
  toward: number;
  width: number;
  elapsedMs: number;
}): boolean {
  const distance = Math.abs(gesture.toward);
  const velocity = distance / Math.max(1, gesture.elapsedMs);
  const committed = distance > gesture.width * COMMIT_RATIO;
  const flicked = velocity > FLICK_SPEED && distance > DIRECTION_SLOP_PX;
  if (gesture.open) {
    return !(gesture.toward < 0 && (committed || flicked));
  }
  return gesture.toward > 0 && (committed || flicked);
}

export function useDrawerGestures(options: DrawerGestureOptions): {
  onTouchStart: (event: TouchEvent) => void;
  onTouchMove: (event: TouchEvent) => void;
  onTouchEnd: () => void;
  onTouchCancel: () => void;
} {
  const { drawerRef } = options;
  const latest = useLatestRef(options);
  const gesture = useRef<Gesture | null>(null);

  return useMemo(
    () => ({
      onTouchStart: (event: TouchEvent) => {
        const { enabled, open } = latest.current;
        if (!enabled || event.touches.length !== 1) {
          return;
        }
        const touch = event.touches[0];
        if (touch === undefined) {
          return;
        }
        const rtl = document.documentElement.dir === "rtl";
        const fromStartEdge = rtl
          ? window.innerWidth - touch.clientX <= EDGE_ZONE_PX
          : touch.clientX <= EDGE_ZONE_PX;
        // Closing can start anywhere: the drawer and its scrim cover the screen.
        if (!open && !fromStartEdge) {
          return;
        }
        gesture.current = {
          startX: touch.clientX,
          startY: touch.clientY,
          at: Date.now(),
          rtl,
          open,
          width: 0,
          dragging: false,
          toward: 0,
        };
      },

      onTouchMove: (event: TouchEvent) => {
        const active = gesture.current;
        if (active === null) {
          return;
        }
        const touch = event.touches[0];
        if (touch === undefined) {
          return;
        }
        const dx = touch.clientX - active.startX;
        const dy = touch.clientY - active.startY;
        if (!active.dragging) {
          if (Math.abs(dx) < DIRECTION_SLOP_PX) {
            if (Math.abs(dy) > DIRECTION_SLOP_PX) {
              gesture.current = null;
            }
            return;
          }
          if (Math.abs(dx) < Math.abs(dy)) {
            gesture.current = null;
            return;
          }
          const drawer = drawerRef.current;
          active.dragging = true;
          active.width = drawer?.offsetWidth ?? window.innerWidth * 0.78;
          if (drawer !== null && drawer !== undefined) {
            drawer.style.transition = "none";
          }
        }
        const drawer = drawerRef.current;
        if (drawer === null || drawer === undefined) {
          return;
        }
        const toward = active.rtl ? -dx : dx;
        active.toward = toward;
        const closedOffset = active.rtl ? active.width : -active.width;
        const raw = (active.open ? 0 : closedOffset) + dx;
        const translate = active.rtl
          ? clamp(raw, 0, active.width)
          : clamp(raw, -active.width, 0);
        drawer.style.transform = `translateX(${translate}px)`;
      },

      onTouchEnd: () => {
        const active = gesture.current;
        gesture.current = null;
        const drawer = drawerRef.current;
        if (drawer !== null && drawer !== undefined) {
          drawer.style.transition = "";
          drawer.style.transform = "";
        }
        if (active === null || !active.dragging) {
          return;
        }
        const nextOpen = resolveGesture({
          open: active.open,
          toward: active.toward,
          width: active.width,
          elapsedMs: Math.max(1, Date.now() - active.at),
        });
        if (nextOpen !== active.open) {
          latest.current.onOpenChange(nextOpen);
        }
      },

      onTouchCancel: () => {
        gesture.current = null;
        const drawer = drawerRef.current;
        if (drawer !== null && drawer !== undefined) {
          drawer.style.transition = "";
          drawer.style.transform = "";
        }
      },
    }),
    [drawerRef, latest],
  );
}
