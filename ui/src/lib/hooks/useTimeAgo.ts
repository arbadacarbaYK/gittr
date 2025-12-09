import { useState, useEffect } from 'react';

/**
 * Safely calculates time ago string, preventing hydration mismatches
 * Returns empty string during SSR and initial render, then updates after mount
 */
export function useTimeAgo(timestamp: number): string {
  const [mounted, setMounted] = useState(false);
  const [timeStr, setTimeStr] = useState('');

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    
    const updateTime = () => {
      const timeAgo = Math.floor((Date.now() - timestamp) / 1000 / 60);
      const str = timeAgo < 1 
        ? "just now" 
        : timeAgo < 60 
          ? `${timeAgo}m ago` 
          : timeAgo < 1440 
            ? `${Math.floor(timeAgo / 60)}h ago` 
            : `${Math.floor(timeAgo / 1440)}d ago`;
      setTimeStr(str);
    };

    updateTime();
    const interval = setInterval(updateTime, 60000); // Update every minute

    return () => clearInterval(interval);
  }, [mounted, timestamp]);

  return timeStr;
}

