"use client";

import { certificates } from "@/data/content";
import { Section, SectionHeading, Reveal } from "@/components/ui/Primitives";

export default function Certificates() {
  return (
    <Section id="certificates">
      <SectionHeading kicker="Credentials" title="Certificates" />

      <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {certificates.map((c, i) => (
          <Reveal key={c.title} delay={(i % 4) * 0.07}>
            <div className="group h-56 [perspective:1200px]" data-cursor="Flip">
              <div className="relative h-full w-full transition-transform duration-700 [transform-style:preserve-3d] group-hover:[transform:rotateY(180deg)]">
                {/* front */}
                <div className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl glass-strong p-5 text-center [backface-visibility:hidden]">
                  <div className="mb-4 grid h-14 w-14 place-items-center rounded-full border border-neon-cyan/40 bg-neon-cyan/10">
                    <svg viewBox="0 0 24 24" className="h-7 w-7 text-neon-cyan" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <circle cx="12" cy="9" r="5" />
                      <path d="M8.5 13.5 7 22l5-3 5 3-1.5-8.5" />
                    </svg>
                  </div>
                  <h3 className="font-display text-base font-semibold text-crystal">
                    {c.title}
                  </h3>
                  <p className="mt-1 text-xs text-crystal/55">{c.issuer}</p>
                  <span className="mt-3 font-mono text-[11px] uppercase tracking-widest text-neon-purple/80">
                    {c.year}
                  </span>
                </div>
                {/* back */}
                <div className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl glass p-5 text-center [transform:rotateY(180deg)] [backface-visibility:hidden]">
                  <p className="text-sm text-crystal/80">{c.blurb}</p>
                  <span className="mt-4 font-mono text-[10px] uppercase tracking-widest text-neon-cyan">
                    Verified credential
                  </span>
                </div>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
      <p className="mt-8 text-center font-mono text-xs text-crystal/40">
        Replace placeholders with your own certificate images & details in{" "}
        <span className="text-neon-cyan">src/data/content.ts</span>
      </p>
    </Section>
  );
}
