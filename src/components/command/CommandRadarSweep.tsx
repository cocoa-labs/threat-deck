'use client';

import { useEffect, useRef } from 'react';

/**
 * Radar sweep animation using canvas with requestAnimationFrame.
 * Draws a rotating conic gradient from center with fade trail.
 */
export function CommandRadarSweep() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const angleRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Handle resize
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      canvas.width = width * window.devicePixelRatio;
      canvas.height = height * window.devicePixelRatio;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    });
    observer.observe(canvas);

    let lastFrame = 0;
    const ROTATION_SPEED = (2 * Math.PI) / 4500; // Full rotation in 4.5s
    const SWEEP_ANGLE = (30 * Math.PI) / 180; // 30 degree trail

    const animate = (timestamp: number) => {
      // Throttle to ~30fps
      if (timestamp - lastFrame < 33) {
        animRef.current = requestAnimationFrame(animate);
        return;
      }
      lastFrame = timestamp;

      const w = canvas.width;
      const h = canvas.height;
      if (w === 0 || h === 0) {
        animRef.current = requestAnimationFrame(animate);
        return;
      }

      const cx = w / 2;
      const cy = h / 2;
      const maxRadius = Math.sqrt(cx * cx + cy * cy);

      angleRef.current += ROTATION_SPEED * 33;
      if (angleRef.current > Math.PI * 2) angleRef.current -= Math.PI * 2;

      ctx.clearRect(0, 0, w, h);

      // Draw sweep gradient
      const sweepEnd = angleRef.current;
      const sweepStart = sweepEnd - SWEEP_ANGLE;

      const gradient = ctx.createConicGradient(sweepStart, cx, cy);
      const sweepFraction = SWEEP_ANGLE / (Math.PI * 2);

      gradient.addColorStop(0, 'rgba(0, 255, 170, 0)');
      gradient.addColorStop(sweepFraction * 0.3, 'rgba(0, 255, 170, 0.02)');
      gradient.addColorStop(sweepFraction * 0.7, 'rgba(0, 255, 170, 0.06)');
      gradient.addColorStop(sweepFraction, 'rgba(0, 255, 170, 0.12)');
      gradient.addColorStop(sweepFraction + 0.001, 'rgba(0, 255, 170, 0)');
      gradient.addColorStop(1, 'rgba(0, 255, 170, 0)');

      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);

      // Draw leading sweep line
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(sweepEnd) * maxRadius, cy + Math.sin(sweepEnd) * maxRadius);
      ctx.strokeStyle = 'rgba(0, 255, 170, 0.25)';
      ctx.lineWidth = 1;
      ctx.stroke();

      animRef.current = requestAnimationFrame(animate);
    };

    animRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animRef.current);
      observer.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0"
      style={{ zIndex: 4, opacity: 0.5 }}
    />
  );
}
