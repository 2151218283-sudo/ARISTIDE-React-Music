"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { getProjectAccent } from "@/data/projectColors";
import { projects } from "@/data/projects";
import { DailyRecommendationStatus } from "@/features/discovery/DailyRecommendationStatus";
import type { Project } from "@/types/project";
import { AboutPanel } from "./AboutPanel";
import { FilmstripGallery } from "./FilmstripGallery";
import {
  ProjectDetailsOverlay,
  type ProjectDetailsPhase,
} from "./ProjectDetailsOverlay";

const DETAILS_ENTRY_DURATION = 1600;
const DETAILS_EXIT_DURATION = 520;

interface HomeExperienceProps {
  initialAbout?: boolean;
}

export function HomeExperience({ initialAbout = false }: HomeExperienceProps) {
  const [isAbout, setIsAbout] = useState(initialAbout);
  const [isOverview, setIsOverview] = useState(true);
  const [sceneProject, setSceneProject] = useState<Project | null>(null);
  const [renderedProject, setRenderedProject] = useState<Project | null>(null);
  const [projectPhase, setProjectPhase] = useState<ProjectDetailsPhase>("hidden");
  const projectPhaseRef = useRef<ProjectDetailsPhase>("hidden");
  const projectTimerRef = useRef<number | null>(null);
  const projectEntryFrameRef = useRef<number | null>(null);

  const clearProjectTimer = useCallback(() => {
    if (projectEntryFrameRef.current !== null) {
      window.cancelAnimationFrame(projectEntryFrameRef.current);
      projectEntryFrameRef.current = null;
    }

    if (projectTimerRef.current !== null) {
      window.clearTimeout(projectTimerRef.current);
      projectTimerRef.current = null;
    }
  }, []);

  const updateProjectPhase = useCallback((phase: ProjectDetailsPhase) => {
    projectPhaseRef.current = phase;
    setProjectPhase(phase);
  }, []);

  const clearProjectImmediately = useCallback(() => {
    clearProjectTimer();
    setSceneProject(null);
    setRenderedProject(null);
    updateProjectPhase("hidden");
  }, [clearProjectTimer, updateProjectPhase]);

  const closeAbout = useCallback(() => {
    setIsAbout(false);
    setIsOverview(true);

    if (window.location.pathname !== "/") {
      window.history.pushState({ page: "home" }, "", "/");
    }
  }, []);

  const closeProject = useCallback(() => {
    const phase = projectPhaseRef.current;

    if (phase === "hidden" || phase === "exiting") {
      return;
    }

    clearProjectTimer();
    updateProjectPhase("exiting");
    setSceneProject(null);
    setIsOverview(true);

    projectTimerRef.current = window.setTimeout(() => {
      setRenderedProject(null);
      updateProjectPhase("hidden");
      projectTimerRef.current = null;
    }, DETAILS_EXIT_DURATION);
  }, [clearProjectTimer, updateProjectPhase]);

  const selectProject = useCallback(
    (project: Project) => {
      if (!isOverview) {
        setIsOverview(true);
        return;
      }

      clearProjectTimer();
      setRenderedProject(project);
      setSceneProject(project);
      updateProjectPhase("hidden");

      projectEntryFrameRef.current = window.requestAnimationFrame(() => {
        projectEntryFrameRef.current = window.requestAnimationFrame(() => {
          projectEntryFrameRef.current = null;
          updateProjectPhase("entering");

          projectTimerRef.current = window.setTimeout(() => {
            if (projectPhaseRef.current === "entering") {
              updateProjectPhase("visible");
            }

            projectTimerRef.current = null;
          }, DETAILS_ENTRY_DURATION);
        });
      });
    },
    [clearProjectTimer, isOverview, updateProjectPhase],
  );

  useEffect(() => {
    const handlePopState = () => {
      const nextIsAbout = window.location.pathname === "/about";
      setIsAbout(nextIsAbout);

      if (nextIsAbout) {
        clearProjectImmediately();
      } else {
        setIsOverview(true);
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [clearProjectImmediately]);

  useEffect(() => {
    const handleDetailsWheel = (event: WheelEvent) => {
      const phase = projectPhaseRef.current;
      const dominantDelta = Math.abs(event.deltaX) >= Math.abs(event.deltaY)
        ? event.deltaX
        : event.deltaY;

      if (
        dominantDelta === 0
        || (phase !== "entering" && phase !== "visible")
      ) {
        return;
      }

      event.preventDefault();
      closeProject();
    };

    window.addEventListener("wheel", handleDetailsWheel, {
      capture: true,
      passive: false,
    });

    return () => window.removeEventListener("wheel", handleDetailsWheel, true);
  }, [closeProject]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      if (isAbout) {
        closeAbout();
      } else if (projectPhaseRef.current !== "hidden") {
        closeProject();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeAbout, closeProject, isAbout]);

  useEffect(() => {
    return clearProjectTimer;
  }, [clearProjectTimer]);

  const accent = renderedProject
    ? getProjectAccent(renderedProject.index)
    : undefined;

  return (
    <>
      <FilmstripGallery
        projects={projects}
        activeProject={sceneProject}
        isInteractive={!isAbout && sceneProject === null}
        isOverview={isOverview}
        onSelect={selectProject}
      />
      <DailyRecommendationStatus />
      <ProjectDetailsOverlay
        project={renderedProject}
        phase={projectPhase}
        accent={accent}
        onClose={closeProject}
      />
      <AboutPanel isOpen={isAbout} />
    </>
  );
}
