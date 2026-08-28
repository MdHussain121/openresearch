'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useProject } from './ProjectContext';
import { api } from '../lib/api';
import type { Author, ExtractionStatus } from '@openresearch/citations';

export type { Author, ExtractionStatus };

export interface PaperSection {
  id: string;
  title: string;
  page_number: number;
  text: string;
  confidence: number;
  unverified?: boolean;
}

export interface PaperTable {
  id: string;
  page_number: number;
  caption: string;
  headers: string[];
  rows: string[][];
  raw_text?: string;
}

export interface PaperEquation {
  id: string;
  page_number: number;
  latex?: string;
  raw_text: string;
  is_text_searchable: boolean;
  status_label: string;
}

export interface PaperReference {
  id: string;
  index?: number;
  title: string;
  authors?: string[];
  year?: number;
  raw_text: string;
}

export interface PaperPage {
  page_number: number;
  text: string;
}

export interface PaperMetadata {
  title?: string;
  authors?: Author[];
  abstract?: string;
  doi?: string;
  arxiv_id?: string;
  year?: number;
  journal?: string;
  volume?: string;
  issue?: string;
  publisher?: string;
  citation_key?: string;
  page_count?: number;
  extraction_status?: ExtractionStatus | string;
  confidence_score?: number;
  sections?: PaperSection[];
  tables?: PaperTable[];
  equations?: PaperEquation[];
  references?: PaperReference[];
  pages?: PaperPage[];
  [key: string]: unknown;
}


export interface Paper {
  id: string;
  project_id: string;
  title: string;
  authors?: Author[];
  abstract?: string;
  doi?: string;
  arxiv_id?: string;
  pmid?: string;
  year?: number;
  pdf_path?: string;
  extraction_status: ExtractionStatus;
  metadata_json?: PaperMetadata;
  created_at: string;
}

export interface PaperAnnotation {
  id: string;
  paper_id: string;
  user_id: string;
  page_number: number;
  selected_text: string;
  highlight_color: string;
  note_text?: string;
  ai_thread?: Array<{ role: 'user' | 'assistant'; message: string; timestamp: string }>;
  position_data?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type PipelineStep = 'upload' | 'extracting' | 'embeddings' | 'ready';

export interface UploadProgress {
  isUploading: boolean;
  filename: string;
  step: PipelineStep;
  isUnverified?: boolean;
  error?: string;
}

interface PaperContextType {
  papers: Paper[];
  activePaper: Paper | null;
  annotations: PaperAnnotation[];
  isLoading: boolean;
  searchQuery: string;
  uploadProgress: UploadProgress | null;
  setSearchQuery: (query: string) => void;
  loadPapers: () => Promise<void>;
  selectPaper: (paper: Paper | null) => Promise<void>;
  uploadPaper: (file: File) => Promise<Paper | null>;
  deletePaper: (paperId: string) => Promise<void>;
  createAnnotation: (data: { page_number: number; selected_text: string; highlight_color?: string; note_text?: string; position_data?: Record<string, unknown> }) => Promise<PaperAnnotation | null>;
  updateAnnotation: (annotationId: string, data: { highlight_color?: string; note_text?: string; ai_thread?: Array<{ role: 'user' | 'assistant'; message: string; timestamp: string }> }) => Promise<void>;
  deleteAnnotation: (annotationId: string) => Promise<void>;
  askPaperAi: (data: { selected_text?: string; page_number?: number; question?: string; prompt_type?: string }) => Promise<{ answer: string; prompt_type: string } | null>;
  dismissUploadProgress: () => void;
}

const PaperContext = createContext<PaperContextType | undefined>(undefined);

export const PaperProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { activeProject } = useProject();
  const [papers, setPapers] = useState<Paper[]>([]);
  const [activePaper, setActivePaper] = useState<Paper | null>(null);
  const [annotations, setAnnotations] = useState<PaperAnnotation[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);

  const loadPapers = useCallback(async () => {
    if (!activeProject) {
      setPapers([]);
      return;
    }

    try {
      setIsLoading(true);
      const list = await api.papers.list(activeProject.id, searchQuery);
      setPapers(list);
      // Persist for offline fallback
      try {
        localStorage.setItem(`openresearch_local_papers_${activeProject.id}`, JSON.stringify(list));
      } catch {}
    } catch (err) {
      console.warn('Failed to load papers from server, using local fallback:', err);
      const localKey = `openresearch_local_papers_${activeProject.id}`;
      const saved = localStorage.getItem(localKey);
      if (saved) {
        try {
          setPapers(JSON.parse(saved));
        } catch {
          setPapers([]);
        }
      } else {
        setPapers([]);
      }
    } finally {
      setIsLoading(false);
    }
  }, [activeProject, searchQuery]);

  useEffect(() => {
    loadPapers();
  }, [loadPapers]);

  const selectPaper = async (paper: Paper | null) => {
    if (!paper) {
      setActivePaper(null);
      setAnnotations([]);
      return;
    }

    try {
      setIsLoading(true);
      const detail = await api.papers.get(paper.id);
      setActivePaper(detail);
      const annots = await api.papers.getAnnotations(paper.id);
      setAnnotations(annots);
    } catch (err) {
      console.warn('Failed to get paper details, using local fallback:', err);
      setActivePaper(paper);
      const key = `openresearch_local_annots_${paper.id}`;
      const saved = localStorage.getItem(key);
      if (saved) {
        try {
          setAnnotations(JSON.parse(saved));
        } catch {
          setAnnotations([]);
        }
      } else {
        setAnnotations([]);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const uploadPaper = async (file: File): Promise<Paper | null> => {
    if (!activeProject) return null;

    setUploadProgress({
      isUploading: true,
      filename: file.name,
      step: 'upload',
    });

    try {
      setUploadProgress((prev) => prev ? { ...prev, step: 'extracting' } : null);
      const paper = await api.papers.upload(activeProject.id, file);
      setUploadProgress((prev) => prev ? {
        ...prev,
        step: 'ready',
        isUnverified: paper.extraction_status === 'unverified',
      } : null);
      await loadPapers();
      return paper;
    } catch (err: unknown) {
      // Server unreachable — create local fallback so offline works
      console.warn('Upload failed on server, creating local entry:', err);
      try {
        const title = file.name.replace(/\.pdf$/i, '').replace(/_/g, ' ');
        const newPaper: Paper = {
          id: `local-paper-${Date.now()}`,
          project_id: activeProject.id,
          title,
          authors: [],
          year: new Date().getFullYear(),
          extraction_status: 'unverified',
          created_at: new Date().toISOString(),
          metadata_json: { title, year: new Date().getFullYear(), extraction_status: 'unverified' },
        };
        const updated = [newPaper, ...papers];
        setPapers(updated);
        try { localStorage.setItem(`openresearch_local_papers_${activeProject.id}`, JSON.stringify(updated)); } catch {}
        setUploadProgress((prev) => prev ? { ...prev, step: 'ready', isUnverified: true } : null);
        return newPaper;
      } catch {
        setUploadProgress((prev) => prev ? {
          ...prev,
          isUploading: false,
          error: err instanceof Error ? err.message : 'Upload failed',
        } : null);
        return null;
      }
    }
  };

  const dismissUploadProgress = () => {
    setUploadProgress(null);
  };

  const deletePaper = async (paperId: string) => {
    if (!activeProject) return;
    try {
      await api.papers.delete(paperId);
    } catch (err) {
      console.warn('Failed to delete paper on server:', err);
    }
    // Always update local state
    const updated = papers.filter((p) => p.id !== paperId);
    setPapers(updated);
    try { localStorage.setItem(`openresearch_local_papers_${activeProject.id}`, JSON.stringify(updated)); } catch {}
    if (activePaper?.id === paperId) {
      setActivePaper(null);
      setAnnotations([]);
    }
    try { await loadPapers(); } catch {}
  };

  const createAnnotation = async (data: {
    page_number: number;
    selected_text: string;
    highlight_color?: string;
    note_text?: string;
    position_data?: Record<string, unknown>;
  }): Promise<PaperAnnotation | null> => {
    if (!activePaper) return null;
    try {
      const annot = await api.papers.createAnnotation(activePaper.id, data);
      setAnnotations((prev) => [...prev, annot]);
      return annot;
    } catch (err) {
      console.warn('Failed to create annotation on server, saving locally:', err);
      const newAnnot: PaperAnnotation = {
        id: `local-annot-${Date.now()}`,
        paper_id: activePaper.id,
        user_id: 'guest',
        page_number: data.page_number,
        selected_text: data.selected_text,
        highlight_color: data.highlight_color || 'yellow',
        note_text: data.note_text,
        position_data: data.position_data,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const updated = [...annotations, newAnnot];
      setAnnotations(updated);
      try { localStorage.setItem(`openresearch_local_annots_${activePaper.id}`, JSON.stringify(updated)); } catch {}
      return newAnnot;
    }
  };

  const updateAnnotation = async (
    annotationId: string,
    data: {
      highlight_color?: string;
      note_text?: string;
      ai_thread?: Array<{ role: 'user' | 'assistant'; message: string; timestamp: string }>;
    }
  ) => {
    if (!activePaper) return;
    try {
      const res = await api.papers.updateAnnotation(activePaper.id, annotationId, data);
      setAnnotations((prev) => prev.map((a) => (a.id === annotationId ? res : a)));
    } catch (err) {
      console.warn('Failed to update annotation on server, saving locally:', err);
      const updated = annotations.map((a) => (a.id === annotationId ? { ...a, ...data, updated_at: new Date().toISOString() } : a));
      setAnnotations(updated);
      try { localStorage.setItem(`openresearch_local_annots_${activePaper.id}`, JSON.stringify(updated)); } catch {}
    }
  };

  const deleteAnnotation = async (annotationId: string) => {
    if (!activePaper) return;
    try {
      await api.papers.deleteAnnotation(activePaper.id, annotationId);
      setAnnotations((prev) => prev.filter((a) => a.id !== annotationId));
    } catch (err) {
      console.warn('Failed to delete annotation on server:', err);
      const updated = annotations.filter((a) => a.id !== annotationId);
      setAnnotations(updated);
      try { localStorage.setItem(`openresearch_local_annots_${activePaper.id}`, JSON.stringify(updated)); } catch {}
    }
  };

  const askPaperAi = async (data: {
    selected_text?: string;
    page_number?: number;
    question?: string;
    prompt_type?: string;
  }) => {
    if (!activePaper) return null;
    try {
      return await api.papers.ask(activePaper.id, data);
    } catch (err) {
      console.warn('Failed to query paper AI:', err);
      return null;
    }
  };

  return (
    <PaperContext.Provider
      value={{
        papers,
        activePaper,
        annotations,
        isLoading,
        searchQuery,
        uploadProgress,
        setSearchQuery,
        loadPapers,
        selectPaper,
        uploadPaper,
        deletePaper,
        createAnnotation,
        updateAnnotation,
        deleteAnnotation,
        askPaperAi,
        dismissUploadProgress,
      }}
    >
      {children}
    </PaperContext.Provider>
  );
};

export const usePaper = () => {
  const context = useContext(PaperContext);
  if (!context) {
    throw new Error('usePaper must be used within a PaperProvider');
  }
  return context;
};
