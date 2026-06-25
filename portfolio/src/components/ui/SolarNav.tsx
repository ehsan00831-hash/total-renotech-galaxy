"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { navItems, type NavId } from "@/data/content";
import { useActiveSection } from "@/lib/hooks";

const ids = navItems.map((n) => n.id);

/**
 * Orbital navigation — planets orbit a glowing core.
 * Desktop & mobile: a fixed core (bottom-right) fans the section "planets"
 * out along an arc. Active section's planet glows. Click scrolls smoothly.
 */
export default function SolarNav() {
  const [open, setOpen] = useState(false);
  const active = useActiveSection(ids);

  const go = (id: NavId) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setOpen(false);
  };

  const n = navItems.length;

  return (
    <nav className="fixed bottom-6 right-6 z-50 sm:bottom-8 sm:right-8" aria-label="Solar navigation">
      {/* faint orbit ring */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            className="pointer-events-none absolute bottom-7 right-7 -z-10 h-[300px] w-[300px] -translate-y-1/2 translate-x-1/2 rounded-full border border-white/10 sm:h-[360px] sm:w-[360px]"
            style={{ transformOrigin: "bottom right" }}
          />
        )}
      </AnimatePresence>

      {/* planets */}
      <AnimatePresence>
        {open &&
          navItems.map((item, i) => {
            const t = n > 1 ? i / (n - 1) : 0;
            const angle = (95 + t * 140) * (Math.PI / 180); // arc into upper-left
            const R = typeof window !== "undefined" && window.innerWidth < 640 ? 120 : 150;
            const dx = Math.cos(angle) * R;
            const dy = Math.sin(angle) * R;
            const isActive = active === item.id;
            return (
              <motion.button
                key={item.id}
                type="button"
                onClick={() => go(item.id)}
                data-cursor={item.label}
                initial={{ opacity: 0, x: 0, y: 0, scale: 0.2 }}
                animate={{ opacity: 1, x: dx, y: -dy, scale: 1 }}
                exit={{ opacity: 0, x: 0, y: 0, scale: 0.2 }}
                transition={{
                  type: "spring",
                  stiffness: 260,
                  damping: 22,
                  delay: i * 0.03,
                }}
                whileHover={{ scale: 1.35 }}
                className="group absolute bottom-6 right-6 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full"
                aria-current={isActive ? "true" : undefined}
              >
                <span
                  className={`absolute inset-0 rounded-full border backdrop-blur-md transition-all duration-300 ${
                    isActive
                      ? "border-neon-cyan bg-neon-cyan/25 shadow-glow"
                      : "border-white/20 bg-white/5 group-hover:border-neon-purple/70"
                  }`}
                />
                <span
                  className={`relative h-2.5 w-2.5 rounded-full transition-all ${
                    isActive
                      ? "bg-neon-cyan shadow-[0_0_10px_2px_rgba(52,231,255,0.9)]"
                      : "bg-crystal/70 group-hover:bg-neon-purple"
                  }`}
                />
                {/* label tag */}
                <span className="pointer-events-none absolute right-full mr-2 whitespace-nowrap rounded-md glass px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-crystal opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                  {item.label}
                </span>
              </motion.button>
            );
          })}
      </AnimatePresence>

      {/* core */}
      <motion.button
        type="button"
        onClick={() => setOpen((o) => !o)}
        data-cursor={open ? "Close" : "Navigate"}
        whileTap={{ scale: 0.9 }}
        className="relative flex h-16 w-16 items-center justify-center rounded-full"
        aria-expanded={open}
        aria-label="Toggle navigation"
      >
        <span className="absolute inset-0 rounded-full bg-gradient-to-br from-neon-cyan via-neon-blue to-neon-purple opacity-90 blur-[2px]" />
        <span className="absolute inset-[3px] rounded-full bg-space-black/80 backdrop-blur" />
        <span className={`absolute inset-0 rounded-full border border-neon-cyan/40 ${open ? "" : "animate-pulse-glow"}`} />
        <motion.span
          animate={{ rotate: open ? 135 : 0 }}
          className="relative font-display text-2xl font-bold text-crystal"
        >
          {open ? "+" : "✦"}
        </motion.span>
      </motion.button>
    </nav>
  );
}
