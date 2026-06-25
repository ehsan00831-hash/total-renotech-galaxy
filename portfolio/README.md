# 🌌 Galaxy Portfolio

A cinematic, galaxy/Matrix-inspired personal portfolio — a luxury "creative universe" built to win clients. Floating planets, a WebGL spiral galaxy, binary code rain, a solar-system navigation, a comet cursor, glassmorphism, and smooth motion throughout.

Built with **Next.js (App Router) · TypeScript · Tailwind CSS · Framer Motion · React Three Fiber (three.js)**.

---

## ✨ Highlights

- **WebGL galaxy background** — spiral particle galaxy, floating crystal planets, star field, mouse + scroll parallax.
- **Solar-system navigation** — section "planets" orbit a glowing core; the active section's planet glows. Works on mobile as a radial menu.
- **Custom comet cursor** — trailing orbital ring, magnetic hover, morphs + shows labels over interactive elements. Auto-disabled on touch.
- **Matrix binary rain** — subtle, premium 0/1 rain in the hero and AI Lab.
- **All sections** — Hero, About, Skill Galaxy, Portfolio (filter + 3D tilt cards), Experience timeline, flip-card Certificates, AI Lab + Photography/Video/3D showcase, Social universe, converting Contact form with a signal-beacon animation.
- **Performance & a11y** — lazy-loaded 3D (no SSR weight), capped particle counts, full `prefers-reduced-motion` fallbacks.
- **SEO** — metadata, Open Graph, Twitter cards, `robots.ts`, `sitemap.ts`, semantic structure.

---

## 🚀 Getting started

```bash
# 1. Install dependencies
npm install

# 2. Run the dev server
npm run dev
# open http://localhost:3000

# 3. Production build
npm run build
npm run start
```

Requires Node 18.17+ (Node 20+ recommended).

---

## 🛠 Customize (the important part)

**Almost everything you'll edit lives in one file:**

### `src/data/content.ts`
Your single source of truth:
- `profile` — name, roles, tagline, email, location, avatar initials
- `heroCopy` — hero headline, sub, CTA labels
- `about` — bio paragraphs + stats
- `skills` — names, levels, blurbs
- `projects` — portfolio items (title, category, description, tools)
- `experience` — timeline entries
- `certificates` — credential cards
- `aiLab` / `mediaShowcase` — AI lab + photography/3D copy
- `socials` — your social links
- `contact` — pitch copy, project types, budget ranges
- `navItems` — the orbiting navigation planets

Change the text here and the whole site updates — no component edits needed.

### Replace placeholder images
Project cards, certificates, and showcase tiles use CSS gradient placeholders.
Drop real images into `public/` and swap the placeholder `<div>`s for `next/image`
in the relevant section components (`src/components/sections/*`).

### Colors & fonts
- Palette + animations: `tailwind.config.ts` and `src/app/globals.css`
- Fonts: `src/app/layout.tsx` (currently Orbitron / Sora / JetBrains Mono via `next/font`)

### Hook up the contact form
`src/components/sections/Contact.tsx` currently opens the visitor's mail client
(`mailto:`). To collect leads, replace the `handle()` submit with a `fetch()` to
your API route / Formspree / Resend / etc.

### SEO / domain
Update `SITE_URL` in `src/app/layout.tsx` and the URLs in
`src/app/robots.ts` + `src/app/sitemap.ts`.

---

## 📁 Structure

```
src/
├─ app/
│  ├─ layout.tsx          # fonts, SEO metadata, <html>/<body>
│  ├─ page.tsx            # assembles all sections + overlays
│  ├─ globals.css         # design system (glass, neon, animations)
│  ├─ robots.ts / sitemap.ts
├─ components/
│  ├─ three/
│  │  ├─ GalaxyBackground.tsx  # R3F scene (galaxy, planets, parallax)
│  │  └─ Scene.tsx             # client lazy-loader (ssr:false)
│  ├─ ui/
│  │  ├─ CustomCursor.tsx
│  │  ├─ LoadingScreen.tsx
│  │  ├─ MatrixRain.tsx
│  │  ├─ SolarNav.tsx          # orbital navigation
│  │  ├─ Primitives.tsx        # MagneticButton, SectionHeading, Reveal, Section
│  │  └─ Footer.tsx
│  └─ sections/
│     ├─ Hero.tsx  About.tsx  Skills.tsx  Projects.tsx
│     ├─ Experience.tsx  Certificates.tsx  AILab.tsx
│     └─ Social.tsx  Contact.tsx
├─ data/
│  └─ content.ts          # ← EDIT YOUR CONTENT HERE
└─ lib/
   └─ hooks.ts            # touch / reduced-motion / active-section
```

---

## ⚡ Performance notes

- The 3D canvas is loaded client-side only (`ssr: false`) and capped at `dpr ≤ 1.6`.
- Particle/star counts drop automatically under `prefers-reduced-motion`.
- Matrix rain runs at ~18fps and uses a single 2D canvas.
- Heavy effects (cursor, parallax, galaxy) disable on touch / reduced-motion devices.

---

## 📦 Deploy

Works out of the box on **Vercel** (recommended) — push to GitHub and import.
Also deployable to Netlify, Render, or any Node host (`npm run build && npm run start`).

---

Built to feel like entering a personal creative universe. Make it yours. ✦
