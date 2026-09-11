"use client";
import { useEffect, useRef, type ComponentPropsWithoutRef, type ElementType } from "react";
import { animate, createScope, stagger } from "animejs";

/**
 * Entrance for a block of content. Children marked `data-reveal` start hidden (see
 * landing.module.css) and fade/rise in order. Under prefers-reduced-motion the CSS never
 * hides them and nothing animates. Pattern from https://animejs.com/documentation/getting-started/using-with-react
 */
export function Reveal<T extends ElementType = "div">({
  as,
  delay = 0,
  children,
  ...rest
}: { as?: T; delay?: number } & Omit<ComponentPropsWithoutRef<T>, "as">) {
  const Tag = (as ?? "div") as ElementType;
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const scope = createScope({
      root: el,
      mediaQueries: { reduceMotion: "(prefers-reduced-motion: reduce)" },
    }).add((self) => {
      const targets = Array.from(el.querySelectorAll<HTMLElement>("[data-reveal]"));
      if (targets.length === 0) return;
      if (self?.matches.reduceMotion) {
        for (const t of targets) t.style.opacity = "1";
        return;
      }
      animate(targets, {
        opacity: [0, 1],
        translateY: [14, 0],
        duration: 800,
        delay: stagger(90, { start: delay }),
        ease: "out(4)",
      });
    });
    return () => scope.revert();
  }, [delay]);

  return (
    <Tag ref={root} {...rest}>
      {children}
    </Tag>
  );
}
