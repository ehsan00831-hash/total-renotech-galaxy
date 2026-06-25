"use client";

import { useEffect, useRef } from "react";
import { usePrefersReducedMotion } from "@/lib/hooks";

/**
 * Subtle binary (0/1) Matrix rain on a 2D canvas.
 * Premium, low-opacity, performance-friendly. Pauses on reduced motion.
 */
export default function MatrixRain({
  className = "",
  opacity = 0.18,
}: {
  className?: string;
  opacity?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let columns = 0;
    let drops: number[] = [];
    const fontSize = 14;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      const parent = canvas.parentElement;
      width = parent?.clientWidth ?? window.innerWidth;
      height = parent?.clientHeight ?? window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      columns = Math.floor(width / fontSize);
      drops = Array.from({ length: columns }, () =>
        Math.floor((Math.random() * height) / fontSize)
      );
    };
    resize();

    let raf = 0;
    let last = 0;
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (t - last < 55) return; // ~18fps is plenty for ambience
      last = t;

      ctx.fillStyle = "rgba(3, 4, 10, 0.16)";
      ctx.fillRect(0, 0, width, height);
      ctx.font = `${fontSize}px var(--font-mono), monospace`;

      for (let i = 0; i < drops.length; i++) {
        const char = Math.random() > 0.5 ? "1" : "0";
        const x = i * fontSize;
        const y = drops[i] * fontSize;
        const bright = Math.random() > 0.975;
        ctx.fillStyle = bright
          ? "rgba(180, 240, 255, 0.9)"
          : "rgba(52, 231, 255, 0.55)";
        ctx.fillText(char, x, y);
        if (y > height && Math.random() > 0.975) drops[i] = 0;
        drops[i]++;
      }
    };

    if (!reduced) raf = requestAnimationFrame(draw);
    else {
      // static faint frame for reduced motion
      ctx.fillStyle = "rgba(52,231,255,0.25)";
      ctx.font = `${fontSize}px monospace`;
      for (let i = 0; i < columns; i++) {
        ctx.fillText(Math.random() > 0.5 ? "1" : "0", i * fontSize, (i * 37) % height);
      }
    }

    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [reduced]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={`pointer-events-none absolute inset-0 ${className}`}
      style={{ opacity }}
    />
  );
}
