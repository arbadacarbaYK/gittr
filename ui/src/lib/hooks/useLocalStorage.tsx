import { useEffect, useState } from "react";

function readStorage<T>(key: string, initialValue: T): T {
  if (typeof window === "undefined") return initialValue;
  try {
    const item = window.localStorage.getItem(key);
    return item ? (JSON.parse(item) as T) : initialValue;
  } catch (error) {
    console.log(error);
    return initialValue;
  }
}

export default function useLocalStorage<T>(key: string, initialValue: T) {
  // Always start from the caller’s initialValue. Reading localStorage in the
  // useState initializer made the first client paint differ from SSR (React #418).
  const [storedValue, setStoredValue] = useState<T | null>(initialValue);

  // Re-read after mount so logged-in chrome appears without a hydration mismatch.
  useEffect(() => {
    setStoredValue(readStorage(key, initialValue));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const setValue = (value: T) => {
    if (value === storedValue || value === undefined || value === null) return;
    try {
      setStoredValue(value);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(key, JSON.stringify(value));
      }
    } catch (error) {
      console.log(error);
    }
  };

  const removeValue = () => {
    try {
      setStoredValue(null);
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(key);
      }
    } catch (error) {
      console.log(error);
    }
  };

  return [storedValue, setValue, removeValue] as const;
}
