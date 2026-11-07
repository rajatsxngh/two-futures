"use client";

import { useEffect, useRef } from "react";

const BARS = 24;

/**
 * Bar waveform drawn from a frequency source (0-255 values), e.g. the
 * conversation's getInputByteFrequencyData. Draws flat bars when inactive.
 */
export function Waveform({
  getData,
  active,
  color = "#f97316",
  className,
}: {
  getData: () => Uint8Array | undefined;
  active: boolean;
  color?: string;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const getDataRef = useRef(getData);

  useEffect(() => {
    getDataRef.current = getData;
  }, [getData]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let frame = 0;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      let data: Uint8Array | undefined;
      if (active) {
        try {
          data = getDataRef.current();
        } catch {
          data = undefined;
        }
      }
      const gap = 3;
      const barW = (w - gap * (BARS - 1)) / BARS;
      ctx.fillStyle = color;
      for (let i = 0; i < BARS; i++) {
        let v = 0;
        if (data && data.length) {
          // Sample the lower ~2/3 of the spectrum, where voice lives.
          const idx = Math.floor((i / BARS) * data.length * 0.66);
          v = data[idx] / 255;
        }
        const barH = Math.max(3, v * h);
        const x = i * (barW + gap);
        const y = (h - barH) / 2;
        ctx.globalAlpha = active ? 0.9 : 0.3;
        ctx.beginPath();
        ctx.roundRect(x, y, barW, barH, barW / 2);
        ctx.fill();
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [active, color]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
