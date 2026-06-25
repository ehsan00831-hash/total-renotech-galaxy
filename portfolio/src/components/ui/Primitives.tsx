"use client";

import { useRef, type ReactNode } from "react";
import { motion, useInView } from "framer-motion";

/* ---------- Magnetic button (cursor attraction) ---------- */
export function MagneticButton({
  children,
  href,
  onClick,
  type = "button",
  variant = "primary",
  cursor,
  className = "",
}: {
  children: ReactNode;
  href?: string;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: "primary" | "ghost";
  cursor?: string;
  className?: string;
}) {
  const ref = useRef<HTMLAnchorElement & HTMLButtonElement>(null);

  const handleMove = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = e.clientX - (r.left + r.width / 2);
    const y = e.clientY - (r.top + r.height / 2);
    el.style.transform = `translate(${x * 0.25}px, ${y * 0.3}px)`;
  };
  const reset = () => {
    if (ref.current) ref.current.style.transform = "translate(0,0)";
  };

  const base =
    "group relative inline-flex items-center justify-center gap-2 rounded-full px-7 py-3 text-sm font-semibold tracking-wide transition-[background,box-shadow,color] duration-300 will-change-transform";
  const styles =
    variant === "primary"
      ? "text-space-black bg-gradient-to-r from-neon-cyan via-neon-blue to-neon-purple shadow-glow hover:shadow-glow-purple"
      : "text-crystal glass hover:border-neon-cyan/50";

  const inner = (
    <span className="relative z-10 inline-flex items-center gap-2">{children}</span>
  );

  const shared = {
    ref,
    onMouseMove: handleMove,
    onMouseLeave: reset,
    "data-cursor": cursor,
    className: `${base} ${styles} ${className}`,
  } as const;

  if (href) {
    const external = href.startsWith("http");
    return (
      <a
        {...shared}
        href={href}
        target={external ? "_blank" : undefined}
        rel={external ? "noopener noreferrer" : undefined}
      >
        {inner}
      </a>
    );
  }
  return (
    <button {...shared} onClick={onClick} type={type}>
      {inner}
    </button>
  );
}

/* ---------- Section heading ---------- */
export function SectionHeading({
  kicker,
  title,
  align = "center",
}: {
  kicker?: string;
  title: string;
  align?: "center" | "left";
}) {
  return (
    <div className={align === "center" ? "text-center" : "text-left"}>
      {kicker && (
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          className="mb-3 font-mono text-xs uppercase tracking-[0.35em] text-neon-cyan/80"
        >
          {kicker}
        </motion.p>
      )}
      <motion.h2
        initial={{ opacity: 0, y: 18 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.6 }}
        className="font-display text-3xl font-bold uppercase tracking-wide sm:text-4xl md:text-5xl gradient-text"
      >
        {title}
      </motion.h2>
      <div
        className={`mt-4 h-px w-24 bg-gradient-to-r from-transparent via-neon-cyan to-transparent ${
          align === "center" ? "mx-auto" : ""
        }`}
      />
    </div>
  );
}

/* ---------- Scroll reveal wrapper ---------- */
export function Reveal({
  children,
  delay = 0,
  y = 24,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* ---------- Section shell ---------- */
export function Section({
  id,
  children,
  className = "",
}: {
  id: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={`relative mx-auto w-full max-w-7xl px-5 py-24 sm:px-8 md:py-32 ${className}`}
    >
      {children}
    </section>
  );
}
