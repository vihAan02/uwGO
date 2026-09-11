"use client";
import { useEffect, useRef, type ComponentPropsWithoutRef, type ElementType } from "react";
import { animate, createScope, stagger } from "animejs";

/**
 * Entrance for a block of content, the same one the landing page uses. Children marked
 * `data-reveal` start hidden (globals.css, motion-safe only) and rise in order. Pass a
 * `key` to replay when content changes (a new day, a fresh parse). Under reduced motion
 * nothing is hidden and nothing animates. https://animejs.com/documentation/getting-started/using-with-react
 */
export function Reveal<T extends ElementType = "div">({
  as,
  delay = 0,
  step = 70,
  duration = 600,
  children,
  ...rest
}: { as?: T; delay?: number; step?: number; duration?: number } & Omit<ComponentPropsWithoutRef<T>, "as">) {
  const Tag = (as ?? "div") as ElementType;
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const scope = createScope({ root: el, mediaQueries: { reduceMotion: "(prefers-reduced-motion: reduce)" } }).add((self) => {
      const targets = Array.from(el.querySelectorAll<HTMLElement>("[data-reveal]"));
      if (targets.length === 0) return;
      if (self?.matches.reduceMotion) {
        for (const t of targets) t.style.opacity = "1";
        return;
      }
      animate(targets, { opacity: [0, 1], translateY: [10, 0], duration, delay: stagger(step, { start: delay }), ease: "out(4)" });
    });
    return () => scope.revert();
  }, [delay, step, duration]);

  return (
    <Tag ref={root} {...rest}>
      {children}
    </Tag>
  );
}
