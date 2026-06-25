"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { profile, heroCopy } from "@/data/content";
import { MagneticButton } from "@/components/ui/Primitives";
import MatrixRain from "@/components/ui/MatrixRain";

function RotatingRole() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((v) => (v + 1) % profile.roles.length), 2200);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="relative inline-block min-w-[10ch] text-neon-cyan text-glow">
      <motion.span
        key={i}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.4 }}
      >
        {profile.roles[i]}
      </motion.span>
    </span>
  );
}

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12, delayChildren: 0.2 } },
};
const item = {
  hidden: { opacity: 0, y: 26 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] } },
};

export default function Hero() {
  return (
    <section
      id="home"
      className="relative flex min-h-[100svh] items-center justify-center overflow-hidden px-5 pb-24 pt-28 sm:px-8"
    >
      <MatrixRain opacity={0.12} className="[mask-image:radial-gradient(circle_at_center,transparent_30%,black_90%)]" />

      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="grid w-full max-w-7xl items-center gap-12 lg:grid-cols-[1.2fr_0.8fr]"
      >
        {/* Left: copy */}
        <div className="text-center lg:text-left">
          <motion.p
            variants={item}
            className="mb-5 inline-block rounded-full glass px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.3em] text-neon-cyan/90"
          >
            {heroCopy.eyebrow}
          </motion.p>

          <motion.h1
            variants={item}
            className="font-display text-5xl font-extrabold uppercase leading-[0.95] tracking-tight sm:text-6xl md:text-7xl"
          >
            <span className="block gradient-text">{heroCopy.headlineLines[0]}</span>
            <span className="block text-glow text-crystal">
              {heroCopy.headlineLines[1]}
            </span>
          </motion.h1>

          <motion.p
            variants={item}
            className="mt-6 text-lg font-light text-crystal/70 sm:text-xl"
          >
            I&apos;m <span className="font-semibold text-crystal">{profile.name}</span> —{" "}
            a <RotatingRole />
          </motion.p>

          <motion.p
            variants={item}
            className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-crystal/60 lg:mx-0 sm:text-base"
          >
            {heroCopy.sub}
          </motion.p>

          <motion.div
            variants={item}
            className="mt-9 flex flex-wrap items-center justify-center gap-4 lg:justify-start"
          >
            <MagneticButton href="#contact" variant="primary" cursor="Let's talk">
              {heroCopy.primaryCta} <span aria-hidden>→</span>
            </MagneticButton>
            <MagneticButton href="#about" variant="ghost" cursor="Scroll">
              {heroCopy.secondaryCta}
            </MagneticButton>
          </motion.div>
        </div>

        {/* Right: floating glass profile card */}
        <motion.div variants={item} className="mx-auto w-full max-w-sm">
          <FloatingProfileCard />
        </motion.div>
      </motion.div>

      {/* scroll hint */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.4 }}
        className="absolute bottom-7 left-1/2 -translate-x-1/2 text-center"
      >
        <div className="mx-auto flex h-9 w-5 justify-center rounded-full border border-white/25 p-1">
          <motion.span
            animate={{ y: [0, 10, 0] }}
            transition={{ repeat: Infinity, duration: 1.6 }}
            className="h-1.5 w-1.5 rounded-full bg-neon-cyan"
          />
        </div>
      </motion.div>
    </section>
  );
}

function FloatingProfileCard() {
  return (
    <motion.div
      animate={{ y: [0, -12, 0] }}
      transition={{ repeat: Infinity, duration: 6, ease: "easeInOut" }}
      className="relative"
      data-cursor="That's me"
    >
      <div className="neon-border relative overflow-hidden rounded-3xl glass-strong p-6">
        {/* avatar orb */}
        <div className="relative mx-auto mb-5 h-40 w-40">
          <div className="absolute inset-0 rounded-full bg-gradient-to-br from-neon-cyan/30 via-neon-blue/20 to-neon-purple/30 blur-md" />
          <div className="absolute inset-2 flex items-center justify-center rounded-full border border-white/20 bg-space-deep/70 backdrop-blur">
            <span className="font-display text-6xl font-bold gradient-text">
              {profile.avatarInitials}
            </span>
          </div>
          <span className="absolute inset-0 rounded-full border border-neon-cyan/30 animate-spin-slow" />
        </div>

        <p className="text-center font-display text-xl font-bold tracking-wide text-crystal">
          {profile.fullName}
        </p>
        <p className="mt-1 text-center font-mono text-[11px] uppercase tracking-widest text-neon-cyan/80">
          {profile.location}
        </p>

        <div className="mt-5 grid grid-cols-3 gap-2 text-center">
          {profile.roles.slice(0, 3).map((r) => (
            <span
              key={r}
              className="rounded-lg border border-white/10 bg-white/5 px-1 py-2 text-[10px] font-medium text-crystal/70"
            >
              {r}
            </span>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-center gap-2">
          <span className="h-2 w-2 animate-pulse rounded-full bg-emerald" />
          <span className="font-mono text-[11px] text-emerald">
            Available for new projects
          </span>
        </div>
      </div>
    </motion.div>
  );
}
