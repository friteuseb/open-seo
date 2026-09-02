import { useQuery } from "@tanstack/react-query";
import { getProjects } from "@/serverFunctions/projects";
import type { ProjectSummary } from "./types";

/** The active project's row, or undefined until the projects query resolves. */
export function useProject(projectId: string): ProjectSummary | undefined {
  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => getProjects(),
  });

  return projectsQuery.data?.find((project) => project.id === projectId);
}
