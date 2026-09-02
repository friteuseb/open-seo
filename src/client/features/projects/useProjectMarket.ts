import { useProject } from "@/client/features/projects/useProject";
import type { ProjectMarket } from "./types";

/** The project's default market, or undefined until the projects query resolves. */
export function useProjectMarket(projectId: string): ProjectMarket | undefined {
  return useProject(projectId);
}
