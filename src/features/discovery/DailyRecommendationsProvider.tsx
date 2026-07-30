"use client";

import type { ReactNode } from "react";
import { createContext, useContext } from "react";

import { useAuth } from "@/features/auth/AuthProvider";

import {
  useDailyRecommendations,
  type DailyRecommendationController,
} from "./useDailyRecommendations";

const DailyRecommendationsContext = createContext<DailyRecommendationController | null>(null);

interface DailyRecommendationsProviderProps {
  children: ReactNode;
}

export function DailyRecommendationsProvider({
  children,
}: DailyRecommendationsProviderProps) {
  const { mode, modeChanging, status, user } = useAuth();
  const recommendations = useDailyRecommendations({
    enabled: status === "ready" && !modeChanging,
    mode,
    userId: user?.id ?? null,
  });
  return (
    <DailyRecommendationsContext.Provider value={recommendations}>
      {children}
    </DailyRecommendationsContext.Provider>
  );
}

export function useDailyRecommendationsState(): DailyRecommendationController {
  const context = useContext(DailyRecommendationsContext);
  if (!context) {
    throw new Error(
      "useDailyRecommendationsState must be used inside DailyRecommendationsProvider.",
    );
  }
  return context;
}
