'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { useAuth } from './AuthContext';

export interface Project {
  id: string;
  name: string;
  description?: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

interface ProjectContextType {
  projects: Project[];
  activeProject: Project;
  isLoadingProjects: boolean;
  setActiveProject: (project: Project) => void;
  createProject: (name: string, description?: string) => Promise<Project>;
  updateProject: (id: string, name?: string, description?: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  refreshProjects: () => Promise<void>;
}

const DEFAULT_LOCAL_PROJECT: Project = {
  id: 'local-default-project',
  name: 'My Research',
  description: '',
  owner_id: 'local-owner-id',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

export const ProjectProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProjectState] = useState<Project>(DEFAULT_LOCAL_PROJECT);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);

  const loadLocalProjects = useCallback((): Project[] => {
    if (typeof window === 'undefined') return [DEFAULT_LOCAL_PROJECT];
    const stored = localStorage.getItem('openresearch_local_projects');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch {
        // Fallback
      }
    }
    const initial = [DEFAULT_LOCAL_PROJECT];
    localStorage.setItem('openresearch_local_projects', JSON.stringify(initial));
    return initial;
  }, []);

  const saveLocalProjects = (items: Project[]) => {
    if (typeof window === 'undefined') return;
    localStorage.setItem('openresearch_local_projects', JSON.stringify(items));
  };

  const refreshProjects = useCallback(async () => {
    setIsLoadingProjects(true);
    try {
      const serverProjects = await api.projects.list();
      if (serverProjects && serverProjects.length > 0) {
        setProjects(serverProjects);
        setActiveProjectState((prev) => {
          if (prev && serverProjects.find((p) => p.id === prev.id)) {
            return serverProjects.find((p) => p.id === prev.id) || serverProjects[0];
          }
          return serverProjects[0];
        });
        setIsLoadingProjects(false);
        return;
      } else {
        const newProj = await api.projects.create({
          name: 'Academic Research Project',
          description: 'Literature review and draft paper',
        });
        setProjects([newProj]);
        setActiveProjectState(newProj);
        setIsLoadingProjects(false);
        return;
      }
    } catch {
      // Server unreachable -> fallback to local storage
    }

    const localList = loadLocalProjects();
    setProjects(localList);
    setActiveProjectState((prev) => {
      if (prev && localList.find((p) => p.id === prev.id)) return prev;
      return localList[0] ?? DEFAULT_LOCAL_PROJECT;
    });
    setIsLoadingProjects(false);
  }, [loadLocalProjects]);

  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

  const setActiveProject = (project: Project) => {
    setActiveProjectState(project);
    if (typeof window !== 'undefined') {
      localStorage.setItem('openresearch_active_project_id', project.id);
    }
  };

  const createProject = async (name: string, description?: string): Promise<Project> => {
    try {
      const created = await api.projects.create({ name, description });
      setProjects((prev) => [created, ...prev]);
      setActiveProject(created);
      return created;
    } catch (err) {
      console.warn('Could not create project on server, falling back locally', err);
    }

    const newLocal: Project = {
      id: `local-proj-${Date.now()}`,
      name,
      description,
      owner_id: user?.personal_owner_id || 'local-owner-id',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const updated = [newLocal, ...projects];
    setProjects(updated);
    saveLocalProjects(updated);
    setActiveProject(newLocal);
    return newLocal;
  };

  const updateProject = async (id: string, name?: string, description?: string) => {
    try {
      const updated = await api.projects.update(id, { name, description });
      setProjects((prev) => prev.map((p) => (p.id === id ? updated : p)));
      if (activeProject?.id === id) {
        setActiveProject(updated);
      }
      return;
    } catch (err) {
      console.warn('Could not update project on server, will save locally', err);
    }

    const updated = projects.map((p) =>
      p.id === id
        ? {
            ...p,
            name: name ?? p.name,
            description: description ?? p.description,
            updated_at: new Date().toISOString(),
          }
        : p
    );
    setProjects(updated);
    saveLocalProjects(updated);
    if (activeProject?.id === id) {
      const active = updated.find((p) => p.id === id);
      if (active) setActiveProject(active);
    }
  };

  const deleteProject = async (id: string) => {
    try {
      await api.projects.delete(id);
    } catch (err) {
      console.warn('Could not delete project on server', err);
    }

    const remaining = projects.filter((p) => p.id !== id);
    setProjects(remaining);
    saveLocalProjects(remaining);
    if (activeProject?.id === id) {
      setActiveProject(remaining[0] || DEFAULT_LOCAL_PROJECT);
    }
  };

  return (
    <ProjectContext.Provider
      value={{
        projects,
        activeProject,
        isLoadingProjects,
        setActiveProject,
        createProject,
        updateProject,
        deleteProject,
        refreshProjects,
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
};

export const useProject = () => {
  const context = useContext(ProjectContext);
  if (!context) {
    throw new Error('useProject must be used within a ProjectProvider');
  }
  return context;
};
