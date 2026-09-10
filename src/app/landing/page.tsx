import type { Metadata } from "next";
import Link from "next/link";
import styles from "./landing.module.css";

export const metadata: Metadata = {
  title: "UW GO | Landing preview",
  robots: { index: false, follow: false },
};

// Workspace placeholder. Build the approved design here before promoting it to /.
export default function LandingPage() {
  return (
    <main className={styles.page}>
      <header>UW GO</header>
      <section className={styles.intro} aria-labelledby="landing-title">
        <h1 id="landing-title">Your campus day, made simpler.</h1>
        <p>Get started with your email, then bring your class schedule.</p>
        <Link href="/login">Get Started</Link>
      </section>
      <footer>Built by students, for students</footer>
    </main>
  );
}
