"use client";

import { motion } from "framer-motion";
import { skills } from "@/data/content";
import { Section, SectionHeading, Reveal } from "@/components/ui/Primitives";

export default function Skills() {
  return (
    <Section id="skills">
      <SectionHeading kicker="One creative system" title="Skill Galaxy" />

      <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {skills.map((s, i) => (
          <Reveal key={s.name} delay={(i % 3) * 0.08}>
            <div
              data-cursor=""
              className="group relative h-full overflow-hidden rounded-2xl glass p-5 transition-all duration-300 hover:-translate-y-1 hover:border-neon-cyan/40"
            >
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-display text-lg font-semibold tracking-wide text-crystal">
                  {s.name}
                </h3>
                <span className="font-mono text-sm text-neon-cyan">{s.level}%</span>
              </div>
              <p className="mb-4 text-sm text-crystal/55">{s.blurb}</p>

              <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <motion.div
                  initial={{ width: 0 }}
                  whileInView={{ width: `${s.level}%` }}
                  viewport={{ once: true }}
                  transition={{ duration: 1, ease: "easeOut", delay: 0.1 }}
                  className="h-full rounded-full bg-gradient-to-r from-neon-cyan via-neon-blue to-neon-purple shadow-glow"
                />
              </div>

              {/* floating orbit glow on hover */}
              <span className="pointer-events-none absolute -bottom-8 -right-8 h-24 w-24 rounded-full bg-neon-purple/10 opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100" />
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
