export interface ProjectWorkMedia {
  slot: number;
  large: string;
  thumbnail: string;
  width: number;
  height: number;
}

export interface ProjectWork {
  slug: string;
  title: string;
  titleRows: string[];
  background: string;
  foreground: string;
  visitUrl: string | null;
  media: ProjectWorkMedia[];
}
