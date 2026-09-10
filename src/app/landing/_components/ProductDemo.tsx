"use client";
import { useEffect, useRef } from "react";
import { createScope, createTimeline, stagger } from "animejs";
import s from "./demo.module.css";

/**
 * Representative data, formatted the way the app formats it (formatClock "h:mm a",
 * formatDuration "9 min"). Buildings are real UW codes from src/data/buildings; the leave
 * time follows the app's rule: class start - walk - 10 min arrival buffer.
 */
const SCHEDULE = [
  { time: "10:00 AM", iso: "10:00", code: "CS 245", comp: "LEC", room: "MC 4045" },
  { time: "11:30 AM", iso: "11:30", code: "MATH 239", comp: "LEC", room: "DC 1351" },
  { time: "1:00 PM", iso: "13:00", code: "ECON 101", comp: "LEC", room: "AL 116" },
  { time: "2:30 PM", iso: "14:30", code: "CS 245", comp: "TUT", room: "MC 4020" },
];

const ROUTE = "M18 44 C 76 44 108 18 160 18 S 246 44 302 44";

/**
 * The story, in order: the pasted schedule appears, UW GO takes it, the next-class card
 * builds, the walk is drawn, and the leave time lands last. Plays once, when at least a
 * quarter of the panel is on screen. Under prefers-reduced-motion the final state is shown
 * immediately (CSS) and no timeline is created.
 */
export function ProductDemo() {
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let observer: IntersectionObserver | undefined;
    let startTimer: ReturnType<typeof setTimeout> | undefined;
    const mountedAt = performance.now();

    const scope = createScope({
      root: el,
      mediaQueries: { reduceMotion: "(prefers-reduced-motion: reduce)" },
    }).add((self) => {
      if (self?.matches.reduceMotion) return;

      const tl = createTimeline({ autoplay: false, defaults: { ease: "out(3)" } })
        .add(el, { opacity: [0, 1], translateY: [16, 0], duration: 560 }, 0)
        .add(`.${s.row}`, { opacity: [0, 1], translateY: [8, 0], duration: 460, delay: stagger(90) }, 200)
        .add(`.${s.connectorLine}`, { opacity: [0, 1], scale: [0, 1], duration: 400 }, 560)
        .add(`.${s.connectorPill}`, { opacity: [0, 1], scale: [0.85, 1], duration: 380 }, 640)
        .add(`.${s.plan}`, { opacity: [0, 1], translateY: [14, 0], duration: 600 }, 800)
        .add(`.${s.planLeg} > *`, { opacity: [0, 1], translateY: [6, 0], duration: 420, delay: stagger(100) }, 1120)
        .add(`.${s.routePath}`, { strokeDashoffset: [1, 0], duration: 900, ease: "inOut(2)" }, 1300)
        .add(`.${s.routeDotEnd}`, { opacity: [0, 1], scale: [0, 1], duration: 320, ease: "out(2)" }, 2060)
        .add(`.${s.leaveIn}`, { opacity: [0, 1], duration: 380 }, 2200);

      // In view at load (phones, tall screens): wait a beat so the hero lands first.
      // Scrolled into view later: play at once.
      observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((e) => e.isIntersecting)) return;
          observer?.disconnect();
          const wait = Math.max(0, 550 - (performance.now() - mountedAt));
          startTimer = setTimeout(() => tl.play(), wait);
        },
        { threshold: 0.25 },
      );
      observer.observe(el);
    });

    return () => {
      observer?.disconnect();
      if (startTimer) clearTimeout(startTimer);
      scope.revert();
    };
  }, []);

  return (
    <figure ref={root} className={s.panel} data-reveal>
      <div className={s.schedule} role="group" aria-label="A pasted Quest schedule">
        <div className={s.cardHead}>
          <span>Quest schedule</span>
          <span>Monday</span>
        </div>
        <ul className={s.rows}>
          {SCHEDULE.map((r) => (
            <li key={`${r.code}-${r.comp}`} className={s.row} data-reveal>
              <time className={s.rowTime} dateTime={r.iso}>
                {r.time}
              </time>
              <span>
                <span className={s.rowCode}>{r.code}</span>
                <span className={s.rowComp}>{r.comp}</span>
              </span>
              <span className={s.rowRoom}>{r.room}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className={s.connector} aria-hidden="true">
        <span className={s.connectorLine} data-reveal />
        <span className={s.connectorPill} data-reveal>
          UW GO
        </span>
        <span className={s.connectorLine} data-reveal />
      </div>

      <div className={s.plan} role="group" aria-label="The plan UW GO builds for the first class" data-reveal>
        <div className={s.planHead}>
          <span>Next class</span>
          <span className={s.leaveIn} data-reveal>
            Leave in 6 min
          </span>
        </div>
        <div className={s.planCourse}>
          <span className={s.planCode}>CS 245</span>
          <time className={s.planTime} dateTime="10:00">
            10:00 AM
          </time>
        </div>
        <div className={s.planRoom}>MC 4045</div>
        <div className={s.planBuilding}>Mathematics &amp; Computer Building</div>
        <div className={s.planLeg}>
          <span className={s.walkChip} data-reveal>
            9 min walk
          </span>
          <span className={s.leaveAt} data-reveal>
            Leave <strong>9:41 AM</strong> from Village 1
          </span>
        </div>
        <svg className={s.route} viewBox="0 0 320 66" aria-hidden="true" focusable="false">
          <path className={s.routeTrack} d={ROUTE} />
          <path className={s.routePath} d={ROUTE} pathLength={1} />
          <circle className={s.routeDot} cx="18" cy="44" r="4.5" />
          <circle className={s.routeDotEnd} cx="302" cy="44" r="4.5" data-reveal />
          <text className={s.routeLabel} x="18" y="62" textAnchor="middle">
            V1
          </text>
          <text className={s.routeLabel} x="302" y="62" textAnchor="middle">
            MC
          </text>
        </svg>
      </div>

      <figcaption className="sr-only">
        Example: a Monday schedule with four classes becomes a plan that says to leave Village 1
        at 9:41 AM for a 9 minute walk to CS 245 in MC 4045. Times are illustrative.
      </figcaption>
    </figure>
  );
}
