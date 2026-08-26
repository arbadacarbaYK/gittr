"use client";

import { createContext, useContext } from "react";

/** Live header counts so Insights matches Star / Fork badges. */
export type RepoChromeStats = {
  nostrStarCount: number;
  githubStarCount: number | null;
  forkCount: number;
};

export const RepoChromeStatsContext = createContext<RepoChromeStats | null>(
  null
);

export function useRepoChromeStats(): RepoChromeStats | null {
  return useContext(RepoChromeStatsContext);
}
