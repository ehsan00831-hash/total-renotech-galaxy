"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { profile } from "@/data/content";

/** Cinematic boot sequence shown once on first paint. */
export default function LoadingScreen() {
  const [done, setDone] = useState(false);
  const [pct, setPct] = useState(0);

  useEffect(() => {
    let frame = 0;
    const start = performance.now();
    const DURATION = 1800;
    const tick = (t: number) => {
      const p = Math.min(100, Math.round(((t - start) / DURATION) * 100));
      setPct(p);
      if (p < 100) frame = requestAnimationFrame(tick);
      else setTimeout(() => setDone(true), 350);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <AnimatePresence>
      {!done && (
        <motion.div
          className="fixed inset-0 z-[10000] flex flex-col items-center justify-center cosmic-bg"
          exit={{ opacity: 0, scale: 1.05 }}
          transition={{ duration: 0.6, ease: "easeInOut" }}
        >
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative mb-8 h-24 w-24"
          >
            <span className="absolute inset-0 rounded-full border border-neon-cyan/40 animate-spin-slow" />
            <span className="absolute inset-2 rounded-full border border-neon-purple/40 animate-[spinSlow_28s_linear_infinite_reverse]" />
            <span className="absolute inset-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-neon-cyan shadow-glow animate-pulse-glow" />
          </motion.div>

          <p className="font-display text-lg uppercase tracking-[0.4em] text-crystal/90">
            {profile.name}
          </p>
          <p className="mt-2 font-mono text-xs tracking-widest text-neon-cyan/80">
            initializing universe… {pct}%
          </p>

          <div className="mt-5 h-[2px] w-56 overflow-hidden rounded-full bg-white/10">
            <motion.div
              className="h-full bg-gradient-to-r from-neon-cyan via-neon-blue to-neon-purple"
              style={{ width: `${pct}%` }}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
