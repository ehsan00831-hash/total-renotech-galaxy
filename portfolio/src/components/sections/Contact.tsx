"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { contact, profile, socials } from "@/data/content";
import { Section, SectionHeading, Reveal, MagneticButton } from "@/components/ui/Primitives";

export default function Contact() {
  const [sent, setSent] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    type: contact.projectTypes[0],
    budget: contact.budgets[0],
    message: "",
  });

  const handle = (e: React.FormEvent) => {
    e.preventDefault();
    // Placeholder submit — wire to your API/email service later.
    // For now we open the user's mail client as a graceful fallback.
    const subject = encodeURIComponent(`New project — ${form.type} (${form.budget})`);
    const body = encodeURIComponent(
      `Name: ${form.name}\nEmail: ${form.email}\nType: ${form.type}\nBudget: ${form.budget}\n\n${form.message}`
    );
    window.location.href = `mailto:${profile.email}?subject=${subject}&body=${body}`;
    setSent(true);
  };

  const field =
    "w-full rounded-xl border border-white/12 bg-white/5 px-4 py-3 text-sm text-crystal placeholder:text-crystal/40 outline-none transition focus:border-neon-cyan/60 focus:bg-white/10";

  return (
    <Section id="contact">
      <SectionHeading kicker={contact.kicker} title={contact.title} />

      <div className="mt-14 grid gap-8 lg:grid-cols-[1fr_1.1fr]">
        {/* Left: pitch + signal beacon */}
        <Reveal className="flex flex-col justify-between gap-8 rounded-3xl glass-strong p-8">
          <div>
            <p className="text-lg leading-relaxed text-crystal/80">{contact.blurb}</p>
            <div className="mt-6 space-y-2 font-mono text-sm text-crystal/70">
              <p>
                <span className="text-neon-cyan">▸ email</span> {profile.email}
              </p>
              <p>
                <span className="text-neon-cyan">▸ status</span>{" "}
                <span className="text-emerald">accepting new projects</span>
              </p>
            </div>
            <div className="mt-6 flex flex-wrap gap-2">
              {socials.slice(0, 5).map((s) => (
                <a
                  key={s.name}
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-cursor={s.name}
                  className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-crystal/70 transition hover:border-neon-cyan/50 hover:text-crystal"
                >
                  {s.name}
                </a>
              ))}
            </div>
          </div>

          {/* signal transmission animation */}
          <div className="relative grid h-28 place-items-center overflow-hidden rounded-2xl border border-white/10 bg-space-deep/40">
            {[0, 1, 2].map((n) => (
              <motion.span
                key={n}
                className="absolute h-10 w-10 rounded-full border border-neon-cyan/50"
                animate={{ scale: [1, 4], opacity: [0.7, 0] }}
                transition={{ duration: 2.4, repeat: Infinity, delay: n * 0.8, ease: "easeOut" }}
              />
            ))}
            <span className="relative z-10 h-3 w-3 rounded-full bg-neon-cyan shadow-glow" />
            <span className="absolute bottom-3 font-mono text-[10px] uppercase tracking-widest text-crystal/50">
              transmitting signal…
            </span>
          </div>
        </Reveal>

        {/* Right: form */}
        <Reveal delay={0.12}>
          {sent ? (
            <div className="grid h-full min-h-[420px] place-items-center rounded-3xl glass-strong p-8 text-center">
              <div>
                <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-emerald/15 text-3xl">
                  ✓
                </div>
                <h3 className="font-display text-2xl font-bold text-crystal">
                  Signal received
                </h3>
                <p className="mt-2 text-crystal/60">
                  Your message is on its way. I&apos;ll reply within 24–48 hours.
                </p>
                <button
                  type="button"
                  onClick={() => setSent(false)}
                  className="mt-6 font-mono text-xs uppercase tracking-widest text-neon-cyan"
                >
                  ← send another
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handle} className="space-y-4 rounded-3xl glass-strong p-8">
              <div className="grid gap-4 sm:grid-cols-2">
                <input
                  required
                  placeholder="Your name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className={field}
                />
                <input
                  required
                  type="email"
                  placeholder="Email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className={field}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                  className={field}
                >
                  {contact.projectTypes.map((t) => (
                    <option key={t} value={t} className="bg-space-navy">
                      {t}
                    </option>
                  ))}
                </select>
                <select
                  value={form.budget}
                  onChange={(e) => setForm({ ...form, budget: e.target.value })}
                  className={field}
                >
                  {contact.budgets.map((b) => (
                    <option key={b} value={b} className="bg-space-navy">
                      {b}
                    </option>
                  ))}
                </select>
              </div>
              <textarea
                required
                rows={5}
                placeholder="Tell me about your project…"
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
                className={`${field} resize-none`}
              />
              <MagneticButton type="submit" variant="primary" cursor="Send" className="w-full">
                {contact.cta} →
              </MagneticButton>
              <p className="text-center font-mono text-[11px] text-crystal/40">
                Opens your mail app · wire up an API in{" "}
                <span className="text-neon-cyan">Contact.tsx</span>
              </p>
            </form>
          )}
        </Reveal>
      </div>
    </Section>
  );
}
