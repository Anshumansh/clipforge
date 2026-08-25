"use client";

import { createContext, useContext } from "react";

const PlanContext = createContext("free");

export function PlanProvider({ plan, children }: { plan: string; children: React.ReactNode }) {
  return <PlanContext.Provider value={plan}>{children}</PlanContext.Provider>;
}

export function useCurrentPlan(): string {
  return useContext(PlanContext);
}
