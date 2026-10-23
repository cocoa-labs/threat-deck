'use client';

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

// ─── Constants ───
const PARTICLE_COUNT = 25;
const ORBIT_RADIUS_MIN = 1.15;
const ORBIT_RADIUS_MAX = 1.6;
const PARTICLE_SIZE = 0.008;

// Vertex shader for point particles with size attenuation
const particleVertexShader = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  varying float vAlpha;

  void main() {
    vAlpha = aAlpha;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (200.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

// Fragment shader: soft glowing dot
const particleFragmentShader = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;

  void main() {
    // Circular soft dot
    float dist = length(gl_PointCoord - vec2(0.5));
    if (dist > 0.5) discard;

    // Soft glow falloff
    float glow = 1.0 - smoothstep(0.0, 0.5, dist);
    glow = pow(glow, 2.0);

    gl_FragColor = vec4(uColor, glow * vAlpha * 0.5);
  }
`;

interface ParticleData {
  // Orbital parameters
  orbitRadius: number;
  orbitSpeed: number;
  orbitPhase: number;
  // Inclination from equator
  inclination: number;
  inclinationPhase: number;
  // Visual
  size: number;
  baseAlpha: number;
}

/** Pre-generate stable random particle data outside the component (pure). */
function generateParticles(): ParticleData[] {
  const data: ParticleData[] = [];
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    data.push({
      orbitRadius: ORBIT_RADIUS_MIN + Math.random() * (ORBIT_RADIUS_MAX - ORBIT_RADIUS_MIN),
      orbitSpeed: 0.05 + Math.random() * 0.15,
      orbitPhase: Math.random() * Math.PI * 2,
      inclination: (Math.random() - 0.5) * Math.PI * 0.8,
      inclinationPhase: Math.random() * Math.PI * 2,
      size: PARTICLE_SIZE * (0.6 + Math.random() * 0.8),
      baseAlpha: 0.3 + Math.random() * 0.5,
    });
  }
  return data;
}

const STABLE_PARTICLES = generateParticles();

export function GlobeParticles() {
  const pointsRef = useRef<THREE.Points>(null);

  // ─── Create geometry attributes ───
  const geometry = useMemo(() => {
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const sizeArr = new Float32Array(PARTICLE_COUNT);
    const alphaArr = new Float32Array(PARTICLE_COUNT);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const p = STABLE_PARTICLES[i];
      if (!p) continue;
      // Initial positions (will be updated in useFrame)
      positions[i * 3] = 0;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = 0;
      sizeArr[i] = p.size * 1000; // Scale for shader
      alphaArr[i] = p.baseAlpha;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizeArr, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphaArr, 1));

    return geo;
  }, []);

  const uniforms = useMemo(
    () => ({
      uColor: { value: new THREE.Color('#44aadd') },
    }),
    [],
  );

  // ─── Animate particles in orbit ───
  useFrame((state) => {
    if (!pointsRef.current) return;
    const elapsed = state.clock.elapsedTime;
    const posAttr = pointsRef.current.geometry.getAttribute('position') as THREE.BufferAttribute;
    const alphaAttr = pointsRef.current.geometry.getAttribute('aAlpha') as THREE.BufferAttribute;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const p = STABLE_PARTICLES[i];
      if (!p) continue;

      // Orbital position
      const angle = p.orbitPhase + elapsed * p.orbitSpeed;
      const incl = p.inclination + 0.1 * Math.sin(elapsed * 0.1 + p.inclinationPhase);

      const x = p.orbitRadius * Math.cos(angle) * Math.cos(incl);
      const y = p.orbitRadius * Math.sin(incl);
      const z = p.orbitRadius * Math.sin(angle) * Math.cos(incl);

      posAttr.setXYZ(i, x, y, z);

      // Subtle alpha flicker
      const flicker = p.baseAlpha * (0.7 + 0.3 * Math.sin(elapsed * 0.8 + i * 2.1));
      alphaAttr.setX(i, flicker);
    }

    posAttr.needsUpdate = true;
    alphaAttr.needsUpdate = true;
  });

  return (
    <points ref={pointsRef} geometry={geometry}>
      <shaderMaterial
        vertexShader={particleVertexShader}
        fragmentShader={particleFragmentShader}
        uniforms={uniforms}
        transparent
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
}
