"use client";

import { useRef, useState } from "react";
import { projects, type Project } from "@/data/content";
import { Section, SectionHeading, Reveal } from "@/components/ui/Primitives";

const categories = ["All", ...Array.from(new Set(projects.map((p) => p.category)))];

export default function Projects() {
  const [filter, setFilter] = useState("All");
  const shown = filter === "All" ? projects : projects.filter((p) => p.category === filter);

  return (
    <Section id="projects">
      <SectionHeading kicker="Selected work" title="Portfolio" />

      <Reveal className="mt-10 flex flex-wrap justify-center gap-2">
        {categories.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setFilter(c)}
            data-cursor=""
            className={`rounded-full px-4 py-1.5 text-xs font-medium tracking-wide transition-all ${
              filter === c
                ? "bg-gradient-to-r from-neon-cyan to-neon-purple text-space-black"
                : "glass text-crystal/70 hover:text-crystal"
            }`}
          >
            {c}
          </button>
        ))}
      </Reveal>

      <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((p, i) => (
          <Reveal key={p.title} delay={(i % 3) * 0.08}>
            <TiltCard project={p} />
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

function TiltCard({ project }: { project: Project }) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState({});

  const onMove = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    setStyle({
      transform: `perspective(900px) rotateY(${px * 10}deg) rotateX(${-py * 10}deg) translateZ(6px)`,
    });
  };
  const reset = () => setStyle({ transform: "perspective(900px) rotateY(0) rotateX(0)" });

  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={reset}
      style={style}
      data-cursor="View"
      className="sweep group relative h-full overflow-hidden rounded-2xl glass-strong p-5 transition-transform duration-200 ease-out will-change-transform"
    >
      {/* image placeholder */}
      <div className={`relative mb-4 aspect-video overflow-hidden rounded-xl bg-gradient-to-br ${project.accent}`}>
        <div className="absolute inset-0 grid place-items-center">
          <span className="font-display text-xs uppercase tracking-[0.3em] text-crystal/40">
            {project.category}
          </span>
        </div>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.12),transparent_55%)]" />
      </div>

      <span className="inline-block rounded-full border border-white/15 px-2.5 py-0.5 text-[10px] uppercase tracking-widest text-neon-cyan/90">
        {project.category}
      </span>
      <h3 className="mt-3 font-display text-xl font-semibold text-crystal">
        {project.title}
      </h3>
      <p className="mt-2 text-sm text-crystal/60">{project.description}</p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {project.tools.map((t) => (
          <span
            key={t}
            className="rounded-md bg-white/5 px-2 py-0.5 font-mono text-[10px] text-crystal/60"
          >
            {t}
          </span>
        ))}
      </div>

      <div className="mt-5 flex items-center gap-2 text-sm font-medium text-neon-cyan opacity-80 transition-opacity group-hover:opacity-100">
        View Project
        <span aria-hidden className="transition-transform group-hover:translate-x-1">→</span>
      </div>
    </div>
  );
}
