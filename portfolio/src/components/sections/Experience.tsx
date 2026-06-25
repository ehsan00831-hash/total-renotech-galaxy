"use client";

import { experience } from "@/data/content";
import { Section, SectionHeading, Reveal } from "@/components/ui/Primitives";

export default function Experience() {
  return (
    <Section id="experience">
      <SectionHeading kicker="Trajectory" title="Experience" />

      <div className="relative mt-16 ml-3 sm:ml-0">
        {/* vertical orbit line */}
        <div className="absolute left-3 top-0 h-full w-px bg-gradient-to-b from-neon-cyan/60 via-neon-purple/40 to-transparent sm:left-1/2" />

        <div className="space-y-12">
          {experience.map((e, i) => {
            const left = i % 2 === 0;
            return (
              <Reveal key={e.role} delay={0.05 * i}>
                <div
                  className={`relative flex flex-col sm:flex-row sm:items-center ${
                    left ? "" : "sm:flex-row-reverse"
                  }`}
                >
                  {/* node */}
                  <span className="absolute left-3 top-1 z-10 h-3.5 w-3.5 -translate-x-1/2 rounded-full bg-neon-cyan shadow-glow sm:left-1/2">
                    <span className="absolute inset-0 animate-ping rounded-full bg-neon-cyan/50" />
                  </span>

                  <div className="w-full pl-10 sm:w-1/2 sm:pl-0 sm:px-8">
                    <div
                      data-cursor=""
                      className="rounded-2xl glass p-6 transition-transform duration-300 hover:-translate-y-1"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="font-display text-lg font-semibold text-crystal">
                          {e.role}
                        </h3>
                        <span className="font-mono text-xs text-neon-cyan">{e.period}</span>
                      </div>
                      <p className="text-sm font-medium text-neon-purple/90">{e.org}</p>
                      <p className="mt-3 text-sm text-crystal/65">{e.description}</p>
                      <p className="mt-3 text-sm text-crystal/80">
                        <span className="text-emerald">★</span> {e.achievement}
                      </p>
                      <div className="mt-4 flex flex-wrap gap-1.5">
                        {e.tools.map((t) => (
                          <span
                            key={t}
                            className="rounded-md bg-white/5 px-2 py-0.5 font-mono text-[10px] text-crystal/60"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="hidden sm:block sm:w-1/2" />
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </Section>
  );
}
