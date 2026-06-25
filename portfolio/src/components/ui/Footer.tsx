import { profile } from "@/data/content";

export default function Footer() {
  return (
    <footer className="relative z-10 border-t border-white/10 px-5 py-10 text-center sm:px-8">
      <p className="font-display text-sm uppercase tracking-[0.3em] gradient-text">
        {profile.name}
      </p>
      <p className="mt-2 font-mono text-xs text-crystal/40">
        Designed & built in deep space · © {new Date().getFullYear()} {profile.name}
      </p>
      <p className="mt-1 font-mono text-[11px] text-crystal/30">
        Next.js · React Three Fiber · Framer Motion · Tailwind
      </p>
    </footer>
  );
}
