import projectWorksJson from "./projectWorks.json";
import type { ProjectWork } from "@/types/projectWork";

export const projectWorks: ProjectWork[] = projectWorksJson;

export function getProjectWork(slug: string): ProjectWork | undefined {
  return projectWorks.find((project) => project.slug === slug);
}
