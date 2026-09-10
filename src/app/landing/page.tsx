import type { Metadata } from "next";
import Link from "next/link";
import styles from "./landing.module.css";
import { buttonVariants } from "./_components/ui/button";
import { ProductDemo } from "./_components/ProductDemo";
import { Reveal } from "./_components/Reveal";
import { cn } from "./_lib/utils";

export const metadata: Metadata = {
  title: "UW GO | Know where to go. And when to leave.",
  description:
    "Paste your Quest class schedule. UW GO turns it into your day: the building, the walk, and the minute to leave.",
  // Preview route. Lift this when /landing is promoted to /.
  robots: { index: false, follow: false },
};

const STEPS = [
  {
    title: "Paste your schedule",
    text: "Copy your class list from Quest and paste it in. It stays on your device.",
  },
  {
    title: "See your day",
    text: "Every class, building, and walk, laid out for each weekday.",
  },
  {
    title: "Know when to leave",
    text: "A leave-at time for every trip, counting down as it gets close.",
  },
];

export default function LandingPage() {
  return (
    <div className={styles.page}>
      {/* Content marked data-reveal starts hidden for the entrance; without JS it must still show. */}
      <noscript>
        <style>{`[data-reveal]{opacity:1!important;transform:none!important}`}</style>
      </noscript>

      <header className={styles.header}>
        <div className={cn(styles.container, styles.headerInner)}>
          <Link href="/landing" className={styles.wordmark} aria-label="UW GO">
            UW GO
          </Link>
          <Link href="/login" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Get Started
          </Link>
        </div>
      </header>

      <main className={styles.main}>
        <Reveal as="section" className={cn(styles.container, styles.hero)} aria-labelledby="landing-title">
          <h1 id="landing-title" className={styles.title} data-reveal>
            <span className={styles.titleLine}>Know where to go.</span>{" "}
            <span className={styles.titleLine}>And when to leave.</span>
          </h1>
          <p className={styles.lede} data-reveal>
            Paste your Quest class schedule. UW GO turns it into your day: the building, the walk,
            and the minute to leave.
          </p>
          <div className={styles.ctaRow} data-reveal>
            <Link href="/login" className={buttonVariants({ size: "xl" })}>
              Get Started
            </Link>
            <p className={styles.hint}>Sign in with your @uwaterloo.ca email.</p>
          </div>
        </Reveal>

        <section className={cn(styles.container, styles.demo)} aria-label="What UW GO does with a schedule">
          <ProductDemo />
        </section>

        <section className={styles.steps} aria-labelledby="steps-title">
          <div className={styles.container}>
            <h2 id="steps-title" className="sr-only">
              How it works
            </h2>
            <ol className={styles.stepsGrid}>
              {STEPS.map((step, i) => (
                <li key={step.title} className={styles.step}>
                  <span className={styles.stepNum} aria-hidden="true">
                    0{i + 1}
                  </span>
                  <h3 className={styles.stepTitle}>{step.title}</h3>
                  <p className={styles.stepText}>{step.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className={styles.closing} aria-labelledby="closing-title">
          <div className={cn(styles.container, styles.closingInner)}>
            <h2 id="closing-title" className={styles.closingTitle}>
              Built by students, for students.
            </h2>
            <p className={styles.closingText}>
              UW GO is an independent student project. It is not affiliated with the University of
              Waterloo.
            </p>
            <Link href="/login" className={cn(buttonVariants({ size: "lg" }), styles.closingCta)}>
              Get Started
            </Link>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={cn(styles.container, styles.footerInner)}>
          <span>UW GO</span>
          <span>Waterloo, Ontario</span>
        </div>
      </footer>
    </div>
  );
}
