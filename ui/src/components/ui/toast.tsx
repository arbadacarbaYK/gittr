"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";

let toastIdCounter = 0;
const toastContainerId = "toast-container-root";

function ensureToastContainer() {
  let container = document.getElementById(toastContainerId);
  if (!container) {
    container = document.createElement("div");
    container.id = toastContainerId;
    container.className = "fixed bottom-4 right-4 z-[100] space-y-2 pointer-events-none";
    document.body.appendChild(container);
  }
  return container;
}

export function showToast(message: string, type: "success" | "error" | "info" = "info", duration = 3000) {
  const container = ensureToastContainer();
  const id = `toast-${toastIdCounter++}`;
  const toastDiv = document.createElement("div");
  toastDiv.id = id;
  toastDiv.className = "pointer-events-auto animate-in slide-in-from-right";
  container.appendChild(toastDiv);

  const bgColor = type === "success" ? "bg-green-900/20 border-green-700" 
    : type === "error" ? "bg-red-900/20 border-red-700"
    : "bg-purple-900/20 border-purple-700";
  
  const textColor = type === "success" ? "text-green-400"
    : type === "error" ? "text-red-400"
    : "text-purple-400";

  const closeToast = () => {
    toastDiv.style.opacity = "0";
    toastDiv.style.transform = "translateX(100%)";
    setTimeout(() => {
      if (toastDiv.parentNode) {
        toastDiv.parentNode.removeChild(toastDiv);
      }
    }, 300);
  };

  toastDiv.innerHTML = `
    <div class="${cn("p-4 border rounded-lg shadow-lg flex items-center gap-3 min-w-[300px] max-w-[500px]", bgColor)}">
      <p class="${cn("flex-1 text-sm", textColor)}">${message.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>
      <button
        onclick="document.getElementById('${id}')?.dispatchEvent(new CustomEvent('close'))"
        class="text-gray-400 hover:text-gray-200"
      >
        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
        </svg>
      </button>
    </div>
  `;

  toastDiv.addEventListener("close", closeToast);
  
  const timer = setTimeout(closeToast, duration);
  
  // Prevent auto-close on hover
  toastDiv.addEventListener("mouseenter", () => clearTimeout(timer));
  toastDiv.addEventListener("mouseleave", () => {
    const newTimer = setTimeout(closeToast, duration);
    toastDiv.dataset.timer = newTimer.toString();
  });
}

