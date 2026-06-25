"use client";

import { socials } from "@/data/content";
import { Section, SectionHeading, Reveal, MagneticButton } from "@/components/ui/Primitives";

export default function Social() {
  return (
    <Section id="social">
      <SectionHeading kicker="Signal across the network" title="Social Universe" />

      <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {socials.map((s, i) => (
          <Reveal key={s.name} delay={(i % 4) * 0.06}>
            <a
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              data-cursor={s.meta}
              className="group relative flex items-center gap-4 overflow-hidden rounded-2xl glass p-4 transition-all duration-300 hover:-translate-y-1 hover:border-neon-cyan/40"
            >
              {/* satellite orb */}
              <span className="relative grid h-12 w-12 shrink-0 place-items-center rounded-full border border-white/15 bg-white/5">
                <span className="font-display text-sm font-bold gradient-text">
                  {s.name.slice(0, 2)}
                </span>
                <span className="absolute inset-0 rounded-full border border-neon-cyan/0 transition-all duration-500 group-hover:border-neon-cyan/40 group-hover:[transform:scale(1.25)]" />
              </span>
              <div className="min-w-0">
                <p className="font-display text-sm font-semibold text-crystal">{s.name}</p>
                <p className="truncate font-mono text-xs text-crystal/55">{s.handle}</p>
                <p className="text-[11px] text-neon-cyan/70 opacity-0 transition-opacity group-hover:opacity-100">
                  {s.meta}
                </p>
              </div>
            </a>
          </Reveal>
        ))}
      </div>

      <Reveal delay={0.2} className="mt-12 text-center">
        <MagneticButton href="#contact" variant="primary" cursor="Connect">
          Follow My Creative Journey →
        </MagneticButton>
      </Reveal>
    </Section>
  );
}
