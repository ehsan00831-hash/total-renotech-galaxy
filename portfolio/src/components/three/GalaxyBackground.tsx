"use client";

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Float, Stars } from "@react-three/drei";
import * as THREE from "three";
import { usePrefersReducedMotion } from "@/lib/hooks";

/* ---------- A spiral galaxy made of points ---------- */
function GalaxyPoints() {
  const ref = useRef<THREE.Points>(null);

  const { positions, colors } = useMemo(() => {
    const COUNT = 6000;
    const positions = new Float32Array(COUNT * 3);
    const colors = new Float32Array(COUNT * 3);
    const arms = 4;
    const radiusMax = 9;
    const inner = new THREE.Color("#34e7ff");
    const outer = new THREE.Color("#a855f7");

    for (let i = 0; i < COUNT; i++) {
      const radius = Math.pow(Math.random(), 0.6) * radiusMax;
      const branch = ((i % arms) / arms) * Math.PI * 2;
      const spin = radius * 0.6;
      const scatter = (Math.random() - 0.5) * (0.3 + radius * 0.08);
      const angle = branch + spin;

      positions[i * 3] = Math.cos(angle) * radius + scatter;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 0.6;
      positions[i * 3 + 2] = Math.sin(angle) * radius + scatter;

      const c = inner.clone().lerp(outer, radius / radiusMax);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    return { positions, colors };
  }, []);

  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.04;
  });

  return (
    <points ref={ref} rotation={[Math.PI * 0.18, 0, 0]} position={[3, -1, -4]}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.035}
        sizeAttenuation
        vertexColors
        transparent
        opacity={0.9}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

/* ---------- Floating crystal planets ---------- */
function Planet({
  position,
  color,
  size,
  speed = 1,
}: {
  position: [number, number, number];
  color: string;
  size: number;
  speed?: number;
}) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.2 * speed;
  });
  return (
    <Float speed={1.4 * speed} rotationIntensity={0.4} floatIntensity={1.1}>
      <mesh ref={ref} position={position}>
        <icosahedronGeometry args={[size, 1]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.35}
          roughness={0.25}
          metalness={0.6}
          flatShading
          transparent
          opacity={0.92}
        />
      </mesh>
    </Float>
  );
}

/* ---------- Mouse + scroll parallax rig ---------- */
function ParallaxRig() {
  const { camera } = useThree();
  const target = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      target.current.x = (e.clientX / window.innerWidth - 0.5) * 2.8;
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  useFrame(() => {
    if (typeof window !== "undefined") {
      // gentle scroll dolly
      const sc = window.scrollY / (document.body.scrollHeight || 1);
      target.current.y = -sc * 2.2;
    }
    camera.position.x += (target.current.x - camera.position.x) * 0.05;
    camera.position.y += (target.current.y + 0.4 - camera.position.y) * 0.05;
    camera.lookAt(0, target.current.y * 0.3, 0);
  });

  return null;
}

export default function GalaxyBackground() {
  const reduced = usePrefersReducedMotion();

  return (
    <div className="fixed inset-0 -z-10">
      <Canvas
        camera={{ position: [0, 0.4, 11], fov: 60 }}
        dpr={[1, 1.6]}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        frameloop={reduced ? "demand" : "always"}
      >
        <color attach="background" args={["#03040a"]} />
        <ambientLight intensity={0.5} />
        <pointLight position={[8, 6, 8]} intensity={40} color="#4d7cff" />
        <pointLight position={[-8, -4, -6]} intensity={30} color="#a855f7" />

        <Stars
          radius={60}
          depth={40}
          count={reduced ? 1500 : 3500}
          factor={3}
          saturation={0}
          fade
          speed={reduced ? 0 : 0.6}
        />

        {!reduced && <GalaxyPoints />}

        <Planet position={[-4.5, 1.6, -1]} color="#34e7ff" size={0.7} speed={1.1} />
        <Planet position={[4.2, -1.4, 0.5]} color="#a855f7" size={1.0} speed={0.8} />
        <Planet position={[2.4, 2.2, -2]} color="#4d7cff" size={0.45} speed={1.3} />
        <Planet position={[-3.2, -2.0, -1.5]} color="#f5c97b" size={0.35} speed={1.5} />

        {!reduced && <ParallaxRig />}
      </Canvas>
      {/* vignette + readability gradient over the canvas */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-space-black/30 via-transparent to-space-black/70" />
    </div>
  );
}
