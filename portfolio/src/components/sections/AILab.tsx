"use client";

import { aiLab, mediaShowcase } from "@/data/content";
import { Section, SectionHeading, Reveal } from "@/components/ui/Primitives";
import MatrixRain from "@/components/ui/MatrixRain";

export default function AILab() {
  return (
    <Section id="ai-lab">
      <div className="relative overflow-hidden rounded-3xl glass-strong p-8 sm:p-12">
        <MatrixRain opacity={0.1} />
        <div className="relative">
          <SectionHeading kicker={aiLab.kicker} title={aiLab.title} align="left" />

          <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_1fr]">
            <Reveal>
              <p className="text-lg leading-relaxed text-crystal/80">{aiLab.intro}</p>
              <div className="mt-6 grid gap-3">
                {aiLab.capabilities.map((c) => (
                  <div
                    key={c}
                    className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3"
                  >
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-neon-cyan/15 font-mono text-xs text-neon-cyan">
                      AI
                    </span>
                    <span className="text-sm text-crystal/80">{c}</span>
                  </div>
                ))}
              </div>
            </Reveal>

            <Reveal delay={0.12}>
              {/* AI brain hologram */}
              <div className="relative grid h-full min-h-[260px] place-items-center rounded-2xl border border-white/10 bg-space-deep/40">
                <div className="relative h-40 w-40">
                  <span className="absolute inset-0 rounded-full border border-neon-cyan/40 animate-spin-slow" />
                  <span className="absolute inset-4 rounded-full border border-neon-purple/40 animate-[spinSlow_24s_linear_infinite_reverse]" />
                  <span className="absolute inset-8 rounded-full border border-neon-blue/40 animate-spin-slow" />
                  <div className="absolute inset-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br from-neon-cyan to-neon-purple opacity-80 blur-[2px]" />
                  <div className="absolute inset-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-crystal animate-pulse-glow" />
                </div>
                <span className="absolute bottom-4 font-mono text-[11px] uppercase tracking-widest text-crystal/50">
                  neural creative core
                </span>
              </div>
            </Reveal>
          </div>
        </div>
      </div>

      {/* Photography & Video + 3D showcase */}
      <div id="showcase" className="mt-10 grid gap-6 md:grid-cols-2">
        {[mediaShowcase.photography, mediaShowcase.threeD].map((m, i) => (
          <Reveal key={m.title} delay={i * 0.1}>
            <div
              data-cursor="Explore"
              className="sweep group relative h-full overflow-hidden rounded-2xl glass p-7 transition-transform duration-300 hover:-translate-y-1"
            >
              <div
                className={`absolute -right-10 -top-10 h-32 w-32 rounded-full blur-2xl ${
                  i === 0 ? "bg-neon-cyan/15" : "bg-neon-purple/15"
                }`}
              />
              <span className="font-mono text-[11px] uppercase tracking-[0.3em] text-neon-cyan/80">
                {m.kicker}
              </span>
              <h3 className="mt-3 font-display text-2xl font-bold text-crystal">
                {m.title}
              </h3>
              <p className="mt-3 text-crystal/65">{m.blurb}</p>
              <div className="mt-5 grid grid-cols-3 gap-2">
                {[0, 1, 2].map((n) => (
                  <div
                    key={n}
                    className={`aspect-square rounded-lg bg-gradient-to-br ${
                      i === 0
                        ? "from-neon-cyan/20 to-neon-blue/5"
                        : "from-neon-purple/20 to-neon-magenta/5"
                    }`}
                  />
                ))}
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
