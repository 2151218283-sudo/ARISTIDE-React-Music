import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ProjectWorkExperience } from "@/components/ProjectWorkExperience";
import { getProjectWork, projectWorks } from "@/data/projectWorks";

interface ProjectWorkPageProps {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return projectWorks.map((project) => ({ slug: project.slug }));
}

export async function generateMetadata({
  params,
}: ProjectWorkPageProps): Promise<Metadata> {
  const { slug } = await params;
  const project = getProjectWork(slug);

  if (!project) {
    return {};
  }

  return {
    title: `Aristide Benoist - ${project.title}`,
  };
}

export default async function ProjectWorkPage({ params }: ProjectWorkPageProps) {
  const { slug } = await params;
  const project = getProjectWork(slug);

  if (!project) {
    notFound();
  }

  return <ProjectWorkExperience project={project} />;
}
