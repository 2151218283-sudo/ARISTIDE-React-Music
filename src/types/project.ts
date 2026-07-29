export interface ProjectMetadata {
  key: string;
  label: string;
  value: string;
}

export interface Project {
  index: number;
  number: string;
  total: string;
  title: string;
  titleRows: string[];
  metadata: ProjectMetadata[];
  description: string[];
  href: string;
  slug: string;
  image: string;
}

