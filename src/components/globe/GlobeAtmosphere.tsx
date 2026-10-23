'use client';

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useGlobeStore } from '@/lib/store/globe-store';

const atmosphereVertexShader = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vPosition;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const atmosphereFragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uTime;
  varying vec3 vNormal;
  varying vec3 vPosition;
  void main() {
    vec3 viewDir = normalize(-vPosition);
    float fresnel = 1.0 - dot(viewDir, vNormal);

    // Wider glow band (pow 2.0 instead of 3.0)
    float glowFresnel = pow(fresnel, 2.0);

    // Soft outer halo for broader visibility
    float outerHalo = pow(fresnel, 1.2) * 0.3;

    // Breathing effect
    float breath = 1.0 + 0.08 * sin(uTime * 0.5);

    // Full intensity - no 0.6 reduction
    float alpha = (glowFresnel + outerHalo) * uIntensity * breath;

    // Slightly boosted color for punch
    vec3 glowColor = uColor * 1.3;

    gl_FragColor = vec4(glowColor, alpha);
  }
`;

// ─── Threat level color thresholds (brighter values) ───
const CALM_COLOR = new THREE.Color('#2266aa');
const ELEVATED_COLOR = new THREE.Color('#aa8822');
const HIGH_COLOR = new THREE.Color('#aa2222');

const COLOR_LERP_SPEED = 0.5;

function getThreatTargetColor(threatLevel: number): THREE.Color {
  if (threatLevel <= 0.3) {
    return CALM_COLOR.clone();
  }
  if (threatLevel <= 0.7) {
    const t = (threatLevel - 0.3) / 0.4;
    const color = CALM_COLOR.clone();
    color.lerp(ELEVATED_COLOR, t);
    return color;
  }
  const t = (threatLevel - 0.7) / 0.3;
  const color = ELEVATED_COLOR.clone();
  color.lerp(HIGH_COLOR, t);
  return color;
}

export function GlobeAtmosphere() {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const threatLevel = useGlobeStore((s) => s.threatLevel);

  const currentColorRef = useRef(getThreatTargetColor(0.3));

  const uniforms = useMemo(
    () => ({
      uColor: { value: getThreatTargetColor(0.3) },
      uIntensity: { value: 2.0 },
      uTime: { value: 0 },
    }),
    [],
  );

  useFrame((state, delta) => {
    if (!materialRef.current) return;
    const mat = materialRef.current;
    const uTime = mat.uniforms.uTime;
    const uColor = mat.uniforms.uColor;

    if (uTime) uTime.value = state.clock.elapsedTime;

    if (uColor) {
      const targetColor = getThreatTargetColor(threatLevel);
      const current = currentColorRef.current;
      const lerpFactor = 1.0 - Math.exp(-COLOR_LERP_SPEED * delta * 3);
      current.lerp(targetColor, lerpFactor);
      uColor.value.copy(current);
    }
  });

  return (
    <mesh scale={[1.08, 1.08, 1.08]}>
      <sphereGeometry args={[1.0, 64, 64]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={atmosphereVertexShader}
        fragmentShader={atmosphereFragmentShader}
        uniforms={uniforms}
        transparent
        blending={THREE.AdditiveBlending}
        side={THREE.BackSide}
        depthWrite={false}
      />
    </mesh>
  );
}
