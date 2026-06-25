"use client";

import { useEffect, useRef, useState } from "react";
import { useIsTouch } from "@/lib/hooks";

/**
 * Futuristic comet cursor with a trailing particle ring.
 * Magnetic / morphing state when hovering interactive elements
 * (anything matching [data-cursor] or a/button).
 * Auto-disabled on touch devices.
 */
export default function CustomCursor() {
  const isTouch = useIsTouch();
  const dotRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const [hovering, setHovering] = useState(false);
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    if (isTouch) return;
    document.body.classList.add("has-custom-cursor");

    const pos = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const ring = { x: pos.x, y: pos.y };
    let raf = 0;

    const onMove = (e: MouseEvent) => {
      pos.x = e.clientX;
      pos.y = e.clientY;
      if (dotRef.current) {
        dotRef.current.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;
      }
    };

    const loop = () => {
      ring.x += (pos.x - ring.x) * 0.18;
      ring.y += (pos.y - ring.y) * 0.18;
      if (ringRef.current) {
        ringRef.current.style.transform = `translate3d(${ring.x}px, ${ring.y}px, 0)`;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const onOver = (e: MouseEvent) => {
      const el = (e.target as HTMLElement)?.closest(
        "a, button, [data-cursor], input, textarea, select, [role='button']"
      ) as HTMLElement | null;
      if (el) {
        setHovering(true);
        setLabel(el.getAttribute("data-cursor"));
      } else {
        setHovering(false);
        setLabel(null);
      }
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseover", onOver);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseover", onOver);
      document.body.classList.remove("has-custom-cursor");
    };
  }, [isTouch]);

  if (isTouch) return null;

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[9999]">
      {/* core comet dot */}
      <div
        ref={dotRef}
        className="absolute left-0 top-0 -ml-1 -mt-1 h-2 w-2 rounded-full bg-neon-cyan"
        style={{ boxShadow: "0 0 12px 2px rgba(52,231,255,0.9)" }}
      />
      {/* trailing orbital ring */}
      <div
        ref={ringRef}
        className="absolute left-0 top-0 flex items-center justify-center rounded-full border transition-[width,height,border-color,background-color] duration-200 ease-out"
        style={{
          width: hovering ? 56 : 30,
          height: hovering ? 56 : 30,
          marginLeft: hovering ? -28 : -15,
          marginTop: hovering ? -28 : -15,
          borderColor: hovering
            ? "rgba(168,85,247,0.9)"
            : "rgba(52,231,255,0.6)",
          background: hovering ? "rgba(168,85,247,0.12)" : "transparent",
          backdropFilter: hovering ? "blur(2px)" : "none",
        }}
      >
        {label && (
          <span className="whitespace-nowrap font-mono text-[9px] uppercase tracking-widest text-crystal">
            {label}
          </span>
        )}
      </div>
    </div>
  );
}
