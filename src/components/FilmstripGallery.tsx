"use client";

import { useEffect, useRef } from "react";

import { FilmstripScene } from "@/lib/webgl/filmstripScene";
import type { Project } from "@/types/project";
import styles from "./FilmstripGallery.module.css";

interface FilmstripGalleryProps {
  projects: Project[];
  activeProject: Project | null;
  isOverview: boolean;
  onSelect: (project: Project) => void;
  isInteractive: boolean;
}

export function FilmstripGallery({
  projects,
  activeProject,
  isOverview,
  onSelect,
  isInteractive,
}: FilmstripGalleryProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hudCanvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<FilmstripScene | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const hudCanvas = hudCanvasRef.current;

    if (!canvas || !hudCanvas) {
      return;
    }

    let scene: FilmstripScene;

    try {
      scene = new FilmstripScene({
        canvas,
        hudCanvas,
        onSelect: () => undefined,
        projects,
      });
    } catch {
      return;
    }

    sceneRef.current = scene;

    return () => {
      scene.destroy();
      sceneRef.current = null;
    };
  }, [projects]);

  useEffect(() => {
    sceneRef.current?.setActiveProject(activeProject);
  }, [activeProject]);

  useEffect(() => {
    sceneRef.current?.setOverview(isOverview);
  }, [isOverview]);

  useEffect(() => {
    sceneRef.current?.setInteractive(isInteractive);
  }, [isInteractive]);

  useEffect(() => {
    sceneRef.current?.setOnSelect(onSelect);
  }, [onSelect]);

  return (
    <section
      className={styles.gallery}
      aria-label="Project filmstrip"
      data-interactive={isInteractive}
      data-overview={isOverview}
    >
      <canvas
        ref={canvasRef}
        className={styles.webglCanvas}
        aria-label="Interactive project gallery"
      />
      <canvas ref={hudCanvasRef} className={styles.hudCanvas} aria-hidden="true" />
    </section>
  );
}
