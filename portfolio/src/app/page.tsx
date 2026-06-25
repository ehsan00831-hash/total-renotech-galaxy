import Scene from "@/components/three/Scene";
import CustomCursor from "@/components/ui/CustomCursor";
import LoadingScreen from "@/components/ui/LoadingScreen";
import SolarNav from "@/components/ui/SolarNav";
import Footer from "@/components/ui/Footer";

import Hero from "@/components/sections/Hero";
import About from "@/components/sections/About";
import Skills from "@/components/sections/Skills";
import Projects from "@/components/sections/Projects";
import Experience from "@/components/sections/Experience";
import Certificates from "@/components/sections/Certificates";
import AILab from "@/components/sections/AILab";
import Social from "@/components/sections/Social";
import Contact from "@/components/sections/Contact";
import { profile } from "@/data/content";

export default function Home() {
  return (
    <>
      <LoadingScreen />
      <CustomCursor />
      <Scene />
      <SolarNav />

      {/* top-left wordmark */}
      <header className="fixed left-5 top-5 z-40 sm:left-8 sm:top-7">
        <a
          href="#home"
          data-cursor="Home"
          className="font-display text-lg font-bold uppercase tracking-[0.25em] gradient-text"
        >
          {profile.name}
          <span className="text-neon-cyan">.</span>
        </a>
      </header>

      <main className="relative z-10">
        <Hero />
        <About />
        <Skills />
        <Projects />
        <Experience />
        <Certificates />
        <AILab />
        <Social />
        <Contact />
        <Footer />
      </main>
    </>
  );
}
