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

    // Draw a proper lightning bolt shape - main trunk with branches (not zigzag!)
    const drawBolt = (x: number, y: number, size: number, rotation: number, opacity: number) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.globalAlpha = opacity;

      const color = `hsl(${280 + Math.random() * 40}, 70%, 70%)`;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "miter";
      
      // Main trunk - goes mostly straight down with slight jagged angles
      // NOT alternating left-right, but following a main path with occasional sharp turns
      ctx.beginPath();
      const trunkPoints: [number, number][] = [
        [0, -size],                      // Top
        [size * 0.08, -size * 0.75],    // Slight right
        [size * 0.12, -size * 0.5],     // Continue right
        [-size * 0.05, -size * 0.35],   // Sharp left turn
        [size * 0.1, -size * 0.2],     // Back right
        [0, 0],                          // Center
        [-size * 0.08, size * 0.2],    // Left
        [size * 0.06, size * 0.4],     // Right
        [-size * 0.1, size * 0.6],     // Left
        [0, size],                       // Bottom
      ];
      
      trunkPoints.forEach((point, i) => {
        if (i === 0) {
          ctx.moveTo(point[0], point[1]);
        } else {
          ctx.lineTo(point[0], point[1]);
        }
      });
      
      ctx.stroke();
      
      // Add branches - these go off to the sides from the main trunk
      // Branch 1 (upper left)
      if (trunkPoints[2]) {
        ctx.beginPath();
        ctx.moveTo(trunkPoints[2][0], trunkPoints[2][1]);
        ctx.lineTo(trunkPoints[2][0] - size * 0.25, trunkPoints[2][1] - size * 0.1);
        ctx.stroke();
      }
      
      // Branch 2 (middle right)
      if (trunkPoints[4]) {
        ctx.beginPath();
        ctx.moveTo(trunkPoints[4][0], trunkPoints[4][1]);
        ctx.lineTo(trunkPoints[4][0] + size * 0.2, trunkPoints[4][1] + size * 0.15);
        ctx.stroke();
      }
      
      // Branch 3 (lower left)
      if (trunkPoints[7]) {
        ctx.beginPath();
        ctx.moveTo(trunkPoints[7][0], trunkPoints[7][1]);
        ctx.lineTo(trunkPoints[7][0] - size * 0.18, trunkPoints[7][1] + size * 0.1);
        ctx.stroke();
      }
      
      // Subtle glow
      ctx.shadowBlur = 2;
      ctx.shadowColor = color;
      ctx.stroke();
      ctx.shadowBlur = 0;
      
      ctx.restore();
    };

    // Animation loop
    const animate = () => {
      const width = canvas.width || window.innerWidth;
      const height = canvas.height || window.innerHeight;
      ctx.clearRect(0, 0, width, height);

      boltsRef.current.forEach((bolt) => {
        // Update position
        bolt.y += bolt.speed;
        bolt.rotation += 0.5; // Slow rotation

        // Reset if off screen
        if (bolt.y > height) {
          bolt.y = -20;
          bolt.x = Math.random() * width;
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
      className="fixed inset-0 pointer-events-none z-10"
      style={{ mixBlendMode: "screen" }}
    />
  );
}

