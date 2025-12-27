"use client";

import { useEffect, useRef } from "react";

interface Digit {
  x: number;
  y: number;
  value: string; // "0" or "1"
  size: number;
  speed: number;
  opacity: number;
}

export function BoltSnow() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const digitsRef = useRef<Digit[]>([]);
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

    // Initialize digits
    const initDigits = () => {
      const digits: Digit[] = [];
      const digitCount = 50; // More digits for snow effect
      
      for (let i = 0; i < digitCount; i++) {
        digits.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          value: Math.random() > 0.5 ? "0" : "1",
          size: 10 + Math.random() * 8, // Font size: 10-18px
          speed: 0.5 + Math.random() * 0.8, // Slow gentle fall: 0.5-1.3
          opacity: 0.1 + Math.random() * 0.2, // Very subtle: 0.1-0.3
        });
      }
      digitsRef.current = digits;
    };

    initDigits();

    // Draw a digit (0 or 1)
    const drawDigit = (x: number, y: number, value: string, size: number, opacity: number) => {
      ctx.save();
      ctx.globalAlpha = opacity;
      
      // Use theme colors (purple/cyan range)
      const hue = 280 + Math.random() * 40;
      ctx.fillStyle = `hsl(${hue}, 70%, 70%)`;
      ctx.font = `${size}px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      
      // Subtle glow
      ctx.shadowBlur = 3;
      ctx.shadowColor = `hsl(${hue}, 70%, 70%)`;
      
      ctx.fillText(value, x, y);
      
      ctx.restore();
    };

    // Animation loop
    const animate = () => {
      const width = canvas.width || window.innerWidth;
      const height = canvas.height || window.innerHeight;
      ctx.clearRect(0, 0, width, height);

      digitsRef.current.forEach((digit) => {
        // Update position - gentle fall like snow
        digit.y += digit.speed;

        // Occasionally change digit (subtle flicker, not annoying)
        if (Math.random() < 0.01) {
          digit.value = digit.value === "0" ? "1" : "0";
        }

        // Reset if off screen
        if (digit.y > height + 20) {
          digit.y = -20;
          digit.x = Math.random() * width;
          digit.value = Math.random() > 0.5 ? "0" : "1";
        }

        // Draw digit
        drawDigit(digit.x, digit.y, digit.value, digit.size, digit.opacity);
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

