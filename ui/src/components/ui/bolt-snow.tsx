"use client";

import { useEffect, useRef } from "react";

interface Bolt {
  x: number;
  y: number;
  size: number;
  speed: number;
  opacity: number;
  rotation: number;
}

export function BoltSnow() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boltsRef = useRef<Bolt[]>([]);
  const animationFrameRef = useRef<number>();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas size
    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    // Initialize bolts
    const initBolts = () => {
      const bolts: Bolt[] = [];
      const boltCount = 20; // Very subtle - only 20 bolts
      
      for (let i = 0; i < boltCount; i++) {
        bolts.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          size: 4 + Math.random() * 6, // Small bolts: 4-10px
          speed: 0.3 + Math.random() * 0.4, // Slow fall: 0.3-0.7
          opacity: 0.15 + Math.random() * 0.15, // Very subtle: 0.15-0.3
          rotation: Math.random() * 360,
        });
      }
      boltsRef.current = bolts;
    };

    initBolts();

    // Draw a simple lightning bolt shape
    const drawBolt = (x: number, y: number, size: number, rotation: number, opacity: number) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.globalAlpha = opacity;

      // Simple zigzag bolt shape
      ctx.beginPath();
      ctx.moveTo(0, -size);
      ctx.lineTo(-size * 0.3, -size * 0.5);
      ctx.lineTo(size * 0.2, -size * 0.3);
      ctx.lineTo(-size * 0.2, 0);
      ctx.lineTo(size * 0.3, size * 0.3);
      ctx.lineTo(-size * 0.2, size * 0.5);
      ctx.lineTo(0, size);
      ctx.strokeStyle = `hsl(${280 + Math.random() * 40}, 70%, 70%)`; // Purple/cyan range
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    };

    // Animation loop
    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      boltsRef.current.forEach((bolt) => {
        // Update position
        bolt.y += bolt.speed;
        bolt.rotation += 0.5; // Slow rotation

        // Reset if off screen
        if (bolt.y > canvas.height) {
          bolt.y = -20;
          bolt.x = Math.random() * canvas.width;
        }

        // Draw bolt
        drawBolt(bolt.x, bolt.y, bolt.size, bolt.rotation, bolt.opacity);
      });

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener("resize", resizeCanvas);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-0"
      style={{ mixBlendMode: "screen" }}
    />
  );
}

