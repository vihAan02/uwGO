"use client";
import { useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent, type ReactNode, type Ref, type RefObject } from "react";
import { animate, type JSAnimation } from "animejs";
import { cn } from "@/lib/utils";
import { PHONE_LAYOUT, prefersReducedMotion, useMediaQuery } from "@/lib/useMediaQuery";
import { EASE_OUT } from "@/lib/motion";
import { available, computeDetents, detentOrder, heightOf, releaseDetent, rubberBand, stepDetent, type Detent, type Detents } from "@/lib/sheetDetents";
import { GESTURE, arbitrate, clickMayFollow, releaseVelocity, settleDuration, type Sample, type TouchOwner } from "@/lib/sheetGesture";

export interface PlanSheetApi {
  snapTo(detent: Detent): void;
}

const WORDS: Record<Detent, string> = { peek: "collapsed", mid: "half open", expanded: "expanded" };
/** Room kept under the sheet so pulling it past expanded never opens a gap below it. */
const OVERSHOOT = 96;
/** Things a tap belongs to, rather than to the sheet. */
const CONTROLS = "button, a, input, select, textarea, summary, label, [role=button], [role=tab], [role=radio], [role=switch]";
const MOUSE_SLOP = 3;
/** The sheet's content column. The surface spans the screen, so a tablet never shows a flat band of ground beside it. */
const COLUMN = "mx-auto w-full max-w-[640px] lg:max-w-none";

interface Gesture {
  pointer: "touch" | "mouse";
  id: number;
  /** Where the pointer went down, and where it is now. */
  x0: number;
  y0: number;
  x: number;
  y: number;
  /** Where the drag is measured from: the point it was claimed at, so the sheet does not jump by the slop. */
  from: number;
  region: "grab" | "content";
  scrollTop: number;
  owner: TouchOwner;
  startHeight: number;
  samples: Sample[];
  detents: Detents;
}

interface Control {
  settle(detent: Detent, animated?: boolean): void;
  cycle(): void;
  step(direction: 1 | -1): void;
}

/**
 * The planner's bottom sheet (DESIGN.md §12): always there on a phone, never dismissed, resting at
 * peek, mid or expanded over the map. A custom component rather than a Drawer or Dialog because it is
 * the page's own content: it must not be announced as a dialog, portal away, trap focus or lock the page,
 * and on a wide screen the very same element is the planner's left column.
 *
 * Per-frame work never touches React. A drag writes one transform; React hears only the detent the sheet
 * settles on. Who owns a touch (the sheet, the list, the browser) is decided once per gesture by
 * `arbitrate`; where a released sheet goes is `releaseDetent`; both are pure and tested.
 */
export function PlanSheet({ apiRef, shellRef, label, summary, accessory, children, className, onDetentChange, onPeekHeight, onScrollTop, onMoving }: {
  apiRef?: Ref<PlanSheetApi>;
  /** The full-screen planner element the sheet's heights are measured against. */
  shellRef: RefObject<HTMLElement | null>;
  label: string;
  /** The grab region under the handle. Its `[data-sheet-peek]` element is what the peek detent shows. */
  summary: ReactNode;
  /** Controls that ride on the sheet's top edge over the map; hidden while expanded. */
  accessory?: ReactNode;
  children: ReactNode;
  className?: string;
  onDetentChange?: (detent: Detent, visibleHeight: number) => void;
  onPeekHeight?: (px: number) => void;
  onScrollTop?: (top: number, max: number) => void;
  onMoving?: (moving: boolean) => void;
}) {
  const phone = useMediaQuery(PHONE_LAYOUT, true);
  const sheetRef = useRef<HTMLElement>(null);
  const grabRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const safeRef = useRef<HTMLDivElement>(null);
  const control = useRef<Control | undefined>(undefined);
  const detentRef = useRef<Detent>("mid");
  const [detent, setDetent] = useState<Detent>("mid");
  const callbacks = useRef({ onDetentChange, onPeekHeight, onScrollTop, onMoving });
  useEffect(() => { callbacks.current = { onDetentChange, onPeekHeight, onScrollTop, onMoving }; });

  useImperativeHandle(apiRef, () => ({ snapTo: (d: Detent) => control.current?.settle(d) }), []);

  useEffect(() => {
    const sheet = sheetRef.current;
    const grab = grabRef.current;
    const handle = handleRef.current;
    const scroller = scrollRef.current;
    const shell = shellRef.current;
    if (!sheet || !grab || !handle || !scroller || !shell) return;
    if (!phone) {
      // The desktop column: no transform, no height, no gestures.
      sheet.style.removeProperty("transform");
      sheet.style.removeProperty("height");
      control.current = undefined;
      return;
    }

    let detents: Detents | undefined;
    let height = 0;
    let anim: JSAnimation | undefined;
    let gesture: Gesture | undefined;
    let frame = 0;
    let pendingHeight: number | undefined;
    let suppressClicksUntil = 0;
    let scrollFrame = 0;
    let measureFrame = 0;

    const write = (h: number) => {
      if (!detents) return;
      height = h;
      sheet.style.transform = `translate3d(0, ${(detents.expanded + OVERSHOOT - h).toFixed(2)}px, 0)`;
    };
    const flush = () => {
      frame = 0;
      if (pendingHeight !== undefined) { write(pendingHeight); pendingHeight = undefined; }
    };
    const moving = (on: boolean) => {
      sheet.dataset.moving = String(on);
      callbacks.current.onMoving?.(on);
    };
    const atRest = () => !detents || Math.abs(height - heightOf(detents, available(detents, detentRef.current))) < 1;

    const settle = (target: Detent, animated = true) => {
      if (!detents) return;
      const resolved = available(detents, target);
      const to = heightOf(detents, resolved);
      anim?.cancel();
      anim = undefined;
      if (frame) { cancelAnimationFrame(frame); frame = 0; pendingHeight = undefined; }
      if (detentRef.current !== resolved) {
        detentRef.current = resolved;
        setDetent(resolved);
      }
      // Told now, not on arrival, so the map frames for where the sheet is going while it goes there.
      callbacks.current.onDetentChange?.(resolved, to);
      const from = height;
      if (!animated || prefersReducedMotion() || Math.abs(to - from) < 1) {
        write(to);
        moving(false);
        return;
      }
      moving(true);
      const proxy = { h: from };
      anim = animate(proxy, {
        h: to,
        duration: settleDuration(to - from),
        ease: EASE_OUT,
        onUpdate: () => write(proxy.h),
        onComplete: () => { anim = undefined; moving(false); },
      });
    };

    const measure = () => {
      const viewport = shell.clientHeight;
      if (!viewport) return;
      const peekEl = grab.querySelector<HTMLElement>("[data-sheet-peek]") ?? grab;
      const safe = safeRef.current ? Number.parseFloat(getComputedStyle(safeRef.current).paddingBottom) || 0 : 0;
      const peekContent = peekEl.getBoundingClientRect().bottom - sheet.getBoundingClientRect().top + 14 + safe;
      const next = computeDetents(viewport, peekContent);
      const first = !detents;
      if (detents && detents.peek === next.peek && detents.mid === next.mid && detents.expanded === next.expanded) return;
      detents = next;
      sheet.style.height = `${next.expanded + OVERSHOOT}px`;
      callbacks.current.onPeekHeight?.(next.peek);
      // A finger or button still down keeps the sheet where it is: a drag keeps its own numbers, and any
      // release, claimed or not, settles against these.
      if (gesture) return;
      settle(detentRef.current, !first);
    };
    const scheduleMeasure = () => {
      if (!measureFrame) measureFrame = requestAnimationFrame(() => { measureFrame = 0; measure(); });
    };

    const begin = (pointer: Gesture["pointer"], id: number, x: number, y: number, target: EventTarget | null, t: number): Gesture | undefined => {
      if (!detents) return undefined;
      // A new press never inherits the click guard of an earlier drag.
      suppressClicksUntil = 0;
      // A settle in flight stops where it is; the finger takes over from there.
      if (anim) { anim.cancel(); anim = undefined; moving(false); }
      return {
        pointer, id, x0: x, y0: y, x, y, from: y,
        region: target instanceof Node && grab.contains(target) ? "grab" : "content",
        scrollTop: scroller.scrollTop,
        owner: "pending",
        startHeight: height,
        samples: [{ t, y }],
        detents,
      };
    };
    const claim = (g: Gesture, y: number) => {
      if (anim) { anim.cancel(); anim = undefined; }
      g.owner = "sheet";
      g.from = y;
      g.startHeight = height;
      sheet.dataset.dragging = "true";
      moving(true);
    };
    const drag = (g: Gesture, y: number, t: number) => {
      g.samples.push({ t, y });
      if (g.samples.length > 12) g.samples.shift();
      pendingHeight = rubberBand(g.startHeight - (y - g.from), g.detents);
      if (!frame) frame = requestAnimationFrame(flush);
    };
    const release = (g: Gesture, t: number, cancelled: boolean) => {
      sheet.dataset.dragging = "false";
      // The click that ends a drag belongs to the drag. The guard is armed only when a click can still come:
      // a finger that dragged makes none, and a guard left waiting would swallow the student's next real tap.
      if (clickMayFollow(g.pointer, Math.hypot(g.x - g.x0, g.y - g.y0))) suppressClicksUntil = performance.now() + GESTURE.suppressClickMs;
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      if (pendingHeight !== undefined) { write(pendingHeight); pendingHeight = undefined; }
      // The finger's velocity is positive moving down; the sheet grows moving up.
      const v = cancelled ? 0 : releaseVelocity(g.samples, t);
      settle(releaseDetent(g.detents, height, -v));
    };

    const touchMoveOptions = { passive: false, capture: true } as const;
    const detachTouch = () => {
      document.removeEventListener("touchmove", onTouchMove, touchMoveOptions);
      document.removeEventListener("touchend", onTouchEnd, true);
      document.removeEventListener("touchcancel", onTouchEnd, true);
    };
    const endTouch = (t: number, cancelled: boolean) => {
      const g = gesture;
      gesture = undefined;
      detachTouch();
      if (!g) return;
      if (g.owner === "sheet") release(g, t, cancelled);
      else if (!atRest()) settle(detentRef.current);
    };
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        if (gesture) endTouch(e.timeStamp, true);
        return;
      }
      const touch = e.touches[0];
      gesture = begin("touch", touch.identifier, touch.clientX, touch.clientY, e.target, e.timeStamp);
      if (!gesture) return;
      document.addEventListener("touchmove", onTouchMove, touchMoveOptions);
      document.addEventListener("touchend", onTouchEnd, true);
      document.addEventListener("touchcancel", onTouchEnd, true);
    };
    function onTouchMove(e: TouchEvent) {
      const g = gesture;
      if (!g || g.pointer !== "touch") return;
      // A second finger is a pinch on the map, not the sheet.
      if (e.touches.length > 1) { endTouch(e.timeStamp, true); return; }
      const touch = Array.from(e.touches).find((x) => x.identifier === g.id);
      if (!touch) return;
      g.x = touch.clientX;
      g.y = touch.clientY;
      if (g.owner === "pending") {
        g.owner = arbitrate({ region: g.region, detent: detentRef.current, scrollTopAtStart: g.scrollTop, dx: touch.clientX - g.x0, dy: touch.clientY - g.y0, cancelable: e.cancelable });
        if (g.owner === "native") {
          gesture = undefined;
          detachTouch();
          if (!atRest()) settle(detentRef.current);
          return;
        }
        if (g.owner === "pending") return;
        claim(g, touch.clientY);
      }
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
      drag(g, touch.clientY, e.timeStamp);
    }
    function onTouchEnd(e: TouchEvent) {
      const g = gesture;
      if (!g || !Array.from(e.changedTouches).some((x) => x.identifier === g.id)) return;
      endTouch(e.timeStamp, e.type === "touchcancel");
    }

    // A mouse or pen drags from the handle and summary; a wheel raises the sheet, then scrolls the day.
    // Once pressed, the pointer is followed on the document: a press released anywhere ends.
    const detachMouse = () => {
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("pointercancel", onPointerUp, true);
    };
    const endMouse = (e: PointerEvent, cancelled: boolean) => {
      const g = gesture;
      gesture = undefined;
      detachMouse();
      if (grab.hasPointerCapture?.(e.pointerId)) grab.releasePointerCapture(e.pointerId);
      if (!g) return;
      if (g.owner === "sheet") release(g, e.timeStamp, cancelled);
      else if (!atRest()) settle(detentRef.current);
    };
    // Capture keeps a claimed drag's events coming outside the window; a pointer that is no longer active cannot be captured.
    const capture = (pointerId: number) => {
      try { grab.setPointerCapture(pointerId); } catch { /* the document listeners still follow it */ }
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "touch" || e.button !== 0) return;
      gesture = begin("mouse", e.pointerId, e.clientX, e.clientY, e.target, e.timeStamp);
      if (!gesture) return;
      document.addEventListener("pointermove", onPointerMove, true);
      document.addEventListener("pointerup", onPointerUp, true);
      document.addEventListener("pointercancel", onPointerUp, true);
    };
    function onPointerMove(e: PointerEvent) {
      const g = gesture;
      if (!g || g.pointer !== "mouse" || e.pointerId !== g.id) return;
      // The button came up where the page never heard it (another window, a context menu): the press is over.
      if ((e.buttons & 1) === 0) { endMouse(e, true); return; }
      g.x = e.clientX;
      g.y = e.clientY;
      if (g.owner === "pending") {
        if (Math.abs(e.clientY - g.y0) < MOUSE_SLOP) return;
        claim(g, e.clientY);
        capture(e.pointerId);
      }
      drag(g, e.clientY, e.timeStamp);
    }
    function onPointerUp(e: PointerEvent) {
      const g = gesture;
      if (!g || g.pointer !== "mouse" || e.pointerId !== g.id) return;
      endMouse(e, e.type === "pointercancel");
    }
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.deltaY <= 0 || gesture || detentRef.current === "expanded") return;
      if (e.target instanceof Node && (grab.contains(e.target) || scroller.contains(e.target))) settle("expanded");
    };

    const onClick = (e: MouseEvent) => {
      // The click that ends a drag belongs to the drag, not to the button it started on.
      if (performance.now() < suppressClicksUntil) {
        suppressClicksUntil = 0;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      // Tapping the summary at peek opens the sheet, the way a card on a map does.
      const target = e.target instanceof Element ? e.target : null;
      if (detentRef.current === "peek" && target && grab.contains(target) && !target.closest(CONTROLS)) settle("mid");
    };
    const onScroll = () => {
      if (scrollFrame) return;
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = 0;
        callbacks.current.onScrollTop?.(scroller.scrollTop, scroller.scrollHeight - scroller.clientHeight);
      });
    };
    // Keyboard focus never lands on something the sheet is hiding: moving into the summary under its peek
    // block at peek raises the sheet to mid, and moving into the day below the fold raises it to expanded.
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target;
      if (detentRef.current === "expanded" || !(target instanceof HTMLElement) || !target.matches(":focus-visible")) return;
      if (scroller.contains(target)) settle("expanded");
      else if (detentRef.current === "peek" && target !== handle && grab.contains(target) && !target.closest("[data-sheet-peek]")) settle("mid");
    };

    control.current = {
      settle,
      cycle: () => {
        if (!detents) return;
        const order = detentOrder(detents);
        settle(order[(order.indexOf(available(detents, detentRef.current)) + 1) % order.length]);
      },
      step: (direction) => { if (detents) settle(stepDetent(detents, detentRef.current, direction)); },
    };

    const ro = new ResizeObserver(scheduleMeasure);
    ro.observe(shell);
    ro.observe(grab);
    measure();

    sheet.addEventListener("touchstart", onTouchStart, { passive: true });
    grab.addEventListener("pointerdown", onPointerDown);
    sheet.addEventListener("wheel", onWheel, { passive: true });
    sheet.addEventListener("click", onClick, true);
    scroller.addEventListener("scroll", onScroll, { passive: true });
    sheet.addEventListener("focusin", onFocusIn);
    return () => {
      sheet.removeEventListener("touchstart", onTouchStart);
      grab.removeEventListener("pointerdown", onPointerDown);
      sheet.removeEventListener("wheel", onWheel);
      sheet.removeEventListener("click", onClick, true);
      scroller.removeEventListener("scroll", onScroll);
      sheet.removeEventListener("focusin", onFocusIn);
      detachTouch();
      detachMouse();
      anim?.cancel();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(scrollFrame);
      cancelAnimationFrame(measureFrame);
      ro.disconnect();
      control.current = undefined;
    };
  }, [phone, shellRef]);

  const onHandleKey = (e: KeyboardEvent) => {
    const c = control.current;
    if (!c) return;
    if (e.key === "ArrowUp") c.step(1);
    else if (e.key === "ArrowDown") c.step(-1);
    else if (e.key === "Home") c.settle("peek");
    else if (e.key === "End") c.settle("expanded");
    else return;
    e.preventDefault();
  };

  return (
    <section
      ref={sheetRef}
      aria-label={label}
      data-detent={detent}
      className={cn(
        "group/sheet fixed inset-x-0 bottom-0 z-20 flex w-full flex-col rounded-t-3xl bg-surface shadow-sheet will-change-transform",
        // Before the first measurement: roughly mid, from CSS alone.
        "max-lg:h-[calc(76dvh+96px)] max-lg:[transform:translate3d(0,calc(26dvh+96px),0)] data-[dragging=true]:select-none",
        "lg:static lg:z-auto lg:rounded-none lg:bg-transparent lg:shadow-none lg:will-change-auto",
        className,
      )}
    >
      <div ref={safeRef} aria-hidden="true" className="pointer-events-none invisible absolute h-0 w-0 pb-[env(safe-area-inset-bottom)]" />
      {accessory && (
        // Hidden while expanded, and out of the tab order with it, so focus never lands on a control nobody can see.
        <div className="pointer-events-none absolute inset-x-0 bottom-full flex justify-end px-3 pb-3 transition-[opacity,visibility] duration-150 ease-standard group-data-[detent=expanded]/sheet:invisible group-data-[detent=expanded]/sheet:opacity-0 lg:hidden [&>*]:pointer-events-auto group-data-[detent=expanded]/sheet:[&>*]:pointer-events-none">
          {accessory}
        </div>
      )}
      <div ref={grabRef} className={cn(COLUMN, "shrink-0 touch-none lg:touch-auto")}>
        <button
          ref={handleRef}
          type="button"
          onClick={() => control.current?.cycle()}
          onKeyDown={onHandleKey}
          aria-label={`Trip panel, ${WORDS[detent]}`}
          aria-expanded={detent === "expanded"}
          // Raised over the summary so its invisible 44px hit area is not painted over by the text below it.
          className="group/handle relative z-10 flex h-6 w-full touch-manipulation items-center justify-center outline-none after:absolute after:inset-x-0 after:top-0 after:h-11 lg:hidden"
        >
          <span aria-hidden="true" className="h-1 w-9 rounded-full bg-line transition-colors duration-150 group-hover/handle:bg-ink-muted/40 group-focus-visible/handle:h-1.5 group-focus-visible/handle:w-12 group-focus-visible/handle:bg-brand" />
        </button>
        {summary}
      </div>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-hidden overscroll-y-none [touch-action:pan-x] group-data-[detent=expanded]/sheet:overflow-y-auto group-data-[detent=expanded]/sheet:[touch-action:pan-y] lg:overflow-visible lg:[touch-action:auto]"
      >
        <div className={COLUMN}>
          {children}
          <div aria-hidden="true" className="h-[calc(env(safe-area-inset-bottom)+7.5rem)] lg:hidden" />
        </div>
      </div>
    </section>
  );
}
