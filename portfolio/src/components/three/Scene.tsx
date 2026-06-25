"use client";

import dynamic from "next/dynamic";

/**
 * Client-only loader for the WebGL galaxy.
 * ssr:false keeps three.js off the server and out of the first HTML payload,
 * so text/SEO content renders instantly and the canvas hydrates after.
 */
const GalaxyBackground = dynamic(() => import("./GalaxyBackground"), {
  ssr: false,
  loading: () => null,
});

export default function Scene() {
  return <GalaxyBackground />;
}
