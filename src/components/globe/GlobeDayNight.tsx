'use client';

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { getSunPosition, latLonToVector3 } from '@/lib/utils/geo';

const vertexShader = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vWorldPosition;

  void main() {
    vNormal = normalize(normalMatrix * normal);
    vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uSunDirection;

  varying vec3 vNormal;
  varying vec3 vWorldPosition;

  void main() {
    vec3 normal = normalize(vWorldPosition);
    float dotProduct = dot(normal, uSunDirection);

    // Night hemisphere: dark overlay
    // smoothstep creates a gradual transition at the terminator
    float nightFactor = 1.0 - smoothstep(-0.05, 0.05, dotProduct);

    // Terminator glow band
    float terminatorGlow = exp(-pow(dotProduct / 0.03, 2.0));

    // Night is dark with slight blue tint
    vec3 nightColor = vec3(0.0, 0.0, 0.02);
    float nightOpacity = nightFactor * 0.20;

    // Cyan terminator line
    vec3 glowColor = vec3(0.0, 1.0, 0.255); // #00ff41
    float glowOpacity = terminatorGlow * 0.4;

    vec3 finalColor = mix(nightColor, glowColor, glowOpacity / max(nightOpacity + glowOpacity, 0.001));
    float finalOpacity = nightOpacity + glowOpacity;

    gl_FragColor = vec4(finalColor, finalOpacity);
  }
`;

export function GlobeDayNight() {
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const uniforms = useMemo(() => {
    const { lat, lon } = getSunPosition();
    const sunPos = latLonToVector3(lat, lon, 1);
    const sunDir = new THREE.Vector3(sunPos[0], sunPos[1], sunPos[2]).normalize();
    return {
      uSunDirection: { value: sunDir },
    };
  }, []);

  // Update sun position every 60 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      if (!materialRef.current) return;
      const { lat, lon } = getSunPosition();
      const sunPos = latLonToVector3(lat, lon, 1);
      const sunDir = new THREE.Vector3(sunPos[0], sunPos[1], sunPos[2]).normalize();
      materialRef.current.uniforms.uSunDirection!.value.copy(sunDir);
    }, 60_000);

    return () => clearInterval(interval);
  }, []);

  return (
    <mesh>
      <sphereGeometry args={[1.002, 64, 64]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        side={THREE.FrontSide}
      />
    </mesh>
  );
}
