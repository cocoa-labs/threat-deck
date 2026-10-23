'use client';

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

// ─── Vertex Shader ───
const earthVertexShader = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vPosition;
  varying vec2 vUv;

  void main() {
    vNormal = normalize(normalMatrix * normal);
    vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// ─── Fragment Shader ───
// Procedural dark earth with visible grid, half-lambert lighting, and bright fresnel
const earthFragmentShader = /* glsl */ `
  uniform float uTime;
  uniform vec3 uOceanColor;
  uniform vec3 uGridColor;
  uniform vec3 uGlowColor;
  uniform float uGlowIntensity;

  varying vec3 vNormal;
  varying vec3 vPosition;
  varying vec2 vUv;

  #define PI 3.14159265359

  void main() {
    // ── Half-lambert diffuse lighting for visible 3D form ──
    vec3 lightDir = normalize(vec3(0.5, 0.8, 1.0));
    float diffuse = dot(vNormal, lightDir) * 0.5 + 0.5;
    diffuse = mix(0.4, 1.0, diffuse);

    vec3 baseColor = uOceanColor * diffuse;

    // ── Latitude / Longitude grid lines ──
    float lat = (vUv.y - 0.5) * PI;
    float lon = (vUv.x - 0.5) * 2.0 * PI;

    // Grid spacing: every 15 degrees
    float latGrid = abs(fract(degrees(lat) / 15.0 + 0.5) - 0.5);
    float lonGrid = abs(fract(degrees(lon) / 15.0 + 0.5) - 0.5);

    float latLine = 1.0 - smoothstep(0.0, 0.04, latGrid);
    float lonLine = 1.0 - smoothstep(0.0, 0.04, lonGrid);

    // Grid at visible intensity (was 0.12, now 0.45)
    float gridIntensity = max(latLine, lonLine) * 0.45;

    // Major lines (every 30 degrees) brighter
    float majorLatGrid = abs(fract(degrees(lat) / 30.0 + 0.5) - 0.5);
    float majorLonGrid = abs(fract(degrees(lon) / 30.0 + 0.5) - 0.5);
    float majorLatLine = 1.0 - smoothstep(0.0, 0.025, majorLatGrid);
    float majorLonLine = 1.0 - smoothstep(0.0, 0.025, majorLonGrid);
    float majorGridIntensity = max(majorLatLine, majorLonLine) * 0.25;

    gridIntensity += majorGridIntensity;

    // Additive grid for glowing lines (not mix which caps brightness)
    vec3 gridEmissive = uGridColor * gridIntensity * 1.5;
    vec3 color = baseColor + gridEmissive;

    // ── Fresnel edge glow ──
    vec3 viewDir = normalize(-vPosition);
    float fresnel = 1.0 - dot(viewDir, vNormal);

    // Inner surface glow - makes globe look lit from within
    float innerGlow = pow(fresnel, 1.5) * 0.3;
    color += uOceanColor * innerGlow * 2.0;

    // Edge fresnel - wider band (pow 2.0 instead of 3.0)
    float edgeFresnel = pow(fresnel, 2.0);
    float shimmer = 1.0 + 0.08 * sin(uTime * 0.3 + vUv.x * 10.0);
    color += uGlowColor * edgeFresnel * uGlowIntensity * shimmer;

    // ── Soft vignette ──
    float edgeDarken = smoothstep(0.0, 0.3, dot(viewDir, vNormal));
    color *= mix(0.7, 1.0, edgeDarken);

    gl_FragColor = vec4(color, 1.0);
  }
`;

export function GlobeMesh() {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uOceanColor: { value: new THREE.Color('#0d2240') },
      uGridColor: { value: new THREE.Color('#2288cc') },
      uGlowColor: { value: new THREE.Color('#4cc9f0') },
      uGlowIntensity: { value: 1.2 },
    }),
    [],
  );

  useFrame((state) => {
    if (materialRef.current) {
      const uTime = materialRef.current.uniforms.uTime;
      if (uTime) uTime.value = state.clock.elapsedTime;
    }
  });

  return (
    <group>
      {/* Main earth sphere with procedural shader */}
      <mesh ref={meshRef}>
        <sphereGeometry args={[1, 96, 96]} />
        <shaderMaterial
          ref={materialRef}
          vertexShader={earthVertexShader}
          fragmentShader={earthFragmentShader}
          uniforms={uniforms}
        />
      </mesh>

      {/* Wireframe overlay for depth */}
      <mesh>
        <sphereGeometry args={[1.001, 36, 36]} />
        <meshBasicMaterial color="#1a6699" wireframe transparent opacity={0.06} />
      </mesh>
    </group>
  );
}
