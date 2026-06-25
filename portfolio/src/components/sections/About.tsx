"use client";

import { about } from "@/data/content";
import { Section, SectionHeading, Reveal } from "@/components/ui/Primitives";

export default function About() {
  return (
    <Section id="about">
      <SectionHeading kicker={about.kicker} title={about.title} />

      <div className="mt-14 grid gap-10 lg:grid-cols-[1.4fr_1fr]">
        <Reveal className="space-y-5">
          {about.paragraphs.map((p, i) => (
            <p
              key={i}
              className={`leading-relaxed ${
                i === 0
                  ? "text-lg text-crystal/90 sm:text-xl"
                  : "text-crystal/65"
              }`}
            >
              {p}
            </p>
          ))}
        </Reveal>

        <Reveal delay={0.15}>
          <div className="grid grid-cols-2 gap-4">
            {about.stats.map((s) => (
              <div
                key={s.label}
                data-cursor=""
                className="group relative overflow-hidden rounded-2xl glass p-5 text-center transition-transform duration-300 hover:-translate-y-1"
              >
                <div className="font-display text-4xl font-bold gradient-text">
                  {s.value}
                </div>
                <div className="mt-2 text-xs uppercase tracking-widest text-crystal/55">
                  {s.label}
                </div>
                <span className="pointer-events-none absolute -right-6 -top-6 h-16 w-16 rounded-full bg-neon-cyan/10 blur-xl transition-opacity group-hover:opacity-100" />
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </Section>
  );
}
