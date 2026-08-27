'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../lib/api';
import { useAuth } from './AuthContext';
import { useProject } from './ProjectContext';
import type { EditorStats } from '@openresearch/editor';
import { BibliographicReference, CitationStyle, CitationItem, AttributionScope } from '@openresearch/citations';

export interface DocumentItem {
  id: string;
  project_id: string;
  title: string;
  content_json?: Record<string, any>;
  plain_text?: string;
  created_at: string;
  updated_at: string;
}

export type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'offline';

interface DocumentContextType {
  documents: DocumentItem[];
  activeDocument: DocumentItem | null;
  isLoadingDocuments: boolean;
  saveStatus: SaveStatus;
  stats: EditorStats;
  citationStyle: CitationStyle;
  documentCitations: CitationItem[];
  recentlyAddedRefId: string | null;
  toastMessage: string | null;
  setCitationStyle: (style: CitationStyle) => void;
  setActiveDocument: (doc: DocumentItem) => void;
  createDocument: (title?: string) => Promise<DocumentItem>;
  syncLocalDocument: (id: string) => Promise<DocumentItem | null>;
  updateActiveDocument: (updates: { title?: string; content_json?: Record<string, any>; plain_text?: string }) => Promise<void>;
  deleteDocument: (id: string) => Promise<void>;
  updateStats: (newStats: EditorStats) => void;
  refreshDocuments: () => Promise<void>;
  handleCitationInserted: (paper: BibliographicReference) => void;
  handleCitationDeleted: (paperId: string) => void;
  clearToast: () => void;
}

function emptyDocumentContent(): Record<string, any> {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [],
      },
    ],
  };
}

const DocumentContext = createContext<DocumentContextType | undefined>(undefined);

interface TipTapNode {
  type?: string;
  attrs?: {
    paperId?: string;
    citationStyle?: string;
    attributionScope?: string;
    pageNumber?: number;
    relevantPassage?: string;
    [key: string]: unknown;
  };
  content?: TipTapNode[];
  [key: string]: unknown;
}

function isCitationNode(node: unknown): node is { type: 'citation'; attrs: { paperId: string; citationStyle?: CitationStyle; attributionScope?: AttributionScope; pageNumber?: number; relevantPassage?: string } } {
  if (!node || typeof node !== 'object') return false;
  const n = node as TipTapNode;
  return n.type === 'citation' && typeof n.attrs?.paperId === 'string' && n.attrs.paperId.length > 0;
}

export const DocumentProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isOfflineMode, isAuthenticated } = useAuth();
  const { activeProject } = useProject();
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [activeDocument, setActiveDocumentState] = useState<DocumentItem | null>(null);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(true);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [stats, setStats] = useState<EditorStats>({
    words: 0,
    characters: 0,
    readingTimeMinutes: 0,
  });

  // Phase 5: Citation management state
  const [citationStyle, setCitationStyle] = useState<CitationStyle>('apa');
  const [documentCitations, setDocumentCitations] = useState<CitationItem[]>([]);
  const [recentlyAddedRefId, setRecentlyAddedRefId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const activeDocRef = useRef<DocumentItem | null>(null);
  useEffect(() => {
    activeDocRef.current = activeDocument;
  }, [activeDocument]);

  const loadRequestRef = useRef<string | null>(null);

  const clearToast = useCallback(() => setToastMessage(null), []);

  const loadLocalDocuments = useCallback((projectId: string): DocumentItem[] => {
    if (typeof window === 'undefined') return [];
    const stored = localStorage.getItem(`openresearch_docs_${projectId}`);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch {
        // Fallback
      }
    }
    const initialDoc: DocumentItem = {
      id: `local-doc-${Date.now()}`,
      project_id: projectId,
      title: '',
      content_json: emptyDocumentContent(),
      plain_text: '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    localStorage.setItem(`openresearch_docs_${projectId}`, JSON.stringify([initialDoc]));
    return [initialDoc];
  }, []);

  const saveLocalDocuments = useCallback((projectId: string, items: DocumentItem[]) => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(`openresearch_docs_${projectId}`, JSON.stringify(items));
  }, []);

  const refreshDocuments = useCallback(async () => {
    if (!activeProject) {
      loadRequestRef.current = null;
      setDocuments([]);
      setActiveDocumentState(null);
      setIsLoadingDocuments(false);
      return;
    }

    const projectId = activeProject.id;
    loadRequestRef.current = projectId;
    const isStale = () => loadRequestRef.current !== projectId;

    setIsLoadingDocuments(true);

    if (isAuthenticated && !isOfflineMode) {
      try {
        const serverDocs = await api.documents.list(projectId);
        if (isStale()) return;
        if (serverDocs && serverDocs.length > 0) {
          const fullDoc = await api.documents.get(serverDocs[0].id);
          if (isStale()) return;
          setDocuments(serverDocs);
          setActiveDocumentState(fullDoc);
          setSaveStatus('saved');
          setIsLoadingDocuments(false);
          return;
        } else {
          const created = await api.documents.create({
            project_id: projectId,
            title: '',
            content_json: emptyDocumentContent(),
            plain_text: '',
          });
          if (isStale()) return;
          setDocuments([created]);
          setActiveDocumentState(created);
          setSaveStatus('saved');
          setIsLoadingDocuments(false);
          return;
        }
      } catch {
        // Server unreachable -> fallback to local storage
      }
    }

    if (isStale()) return;
    const localList = loadLocalDocuments(projectId);
    setDocuments(localList);
    setActiveDocumentState(localList[0] || null);
    setSaveStatus(isOfflineMode ? 'offline' : 'saved');
    setIsLoadingDocuments(false);
  }, [activeProject, isAuthenticated, isOfflineMode, loadLocalDocuments]);

  useEffect(() => {
    refreshDocuments();
  }, [refreshDocuments]);

  const loadCitations = useCallback(async (docId: string) => {
    if (!docId) return;
    if (isAuthenticated && !isOfflineMode && !docId.startsWith('local-')) {
      try {
        const cits = await api.citations.list(docId);
        const mapped: CitationItem[] = cits.map((c) => ({
          id: c.id,
          documentId: c.document_id,
          paperId: c.paper_id,
          position: c.position,
          citationStyle: (c.citation_style as CitationStyle) || 'apa',
          attributionScope: (c.attribution_scope as AttributionScope) || 'direct_quote',
          pageNumber: c.page_number,
          relevantPassage: c.relevant_passage,
        }));
        setDocumentCitations(mapped);
        return;
      } catch {
        // Fallback
      }
    }
    // Extract from content_json or local storage
    if (activeDocRef.current?.content_json) {
      const extracted: CitationItem[] = [];
      const traverse = (node: unknown) => {
        if (isCitationNode(node)) {
          extracted.push({
            id: `cit-${node.attrs.paperId}-${extracted.length}`,
            documentId: docId,
            paperId: node.attrs.paperId,
            position: extracted.length + 1,
            citationStyle: (node.attrs.citationStyle as CitationStyle) || 'apa',
            attributionScope: (node.attrs.attributionScope as AttributionScope) || 'sentence',
            pageNumber: node.attrs.pageNumber,
            relevantPassage: node.attrs.relevantPassage,
          });
        }
        const candidate = node as TipTapNode;
        if (Array.isArray(candidate?.content)) {
          candidate.content.forEach(traverse);
        }
      };
      traverse(activeDocRef.current.content_json);
      setDocumentCitations(extracted);
    }
  }, [isAuthenticated, isOfflineMode]);

  useEffect(() => {
    if (activeDocument?.id) {
      loadCitations(activeDocument.id);
    }
  }, [activeDocument?.id, loadCitations]);

  const setActiveDocument = async (doc: DocumentItem) => {
    if (isAuthenticated && !isOfflineMode && doc.id && !doc.id.startsWith('local-')) {
      try {
        const fullDoc = await api.documents.get(doc.id);
        setActiveDocumentState(fullDoc);
        loadCitations(fullDoc.id);
        return;
      } catch {
        // Fallback
      }
    }
    setActiveDocumentState(doc);
    loadCitations(doc.id);
  };

  const createDocument = async (title: string = ''): Promise<DocumentItem> => {
    if (!activeProject) throw new Error('No active project');
    const projectId = activeProject.id;

    if (isAuthenticated && !isOfflineMode) {
      try {
        const created = await api.documents.create({
          project_id: projectId,
          title,
          content_json: emptyDocumentContent(),
          plain_text: '',
        });
        setDocuments((prev) => [created, ...prev]);
        setActiveDocumentState(created);
        setSaveStatus('saved');
        setDocumentCitations([]);
        return created;
      } catch (err) {
        console.warn('Could not create document on server, creating locally', err);
      }
    }

    const localDoc: DocumentItem = {
      id: `local-doc-${Date.now()}`,
      project_id: projectId,
      title,
      content_json: emptyDocumentContent(),
      plain_text: '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const updated = [localDoc, ...documents];
    setDocuments(updated);
    saveLocalDocuments(projectId, updated);
    setActiveDocumentState(localDoc);
    setSaveStatus('saved');
    setDocumentCitations([]);
    return localDoc;
  };

  /**
   * Migrates a localStorage-only document (`local-*` id) to the server so
   * server-side features (export, citations, versions) can operate on it.
   * Returns the server document, or null when the doc is not local / cannot
   * be synced (offline, unreachable API).
   */
  const syncLocalDocument = useCallback(
    async (id: string): Promise<DocumentItem | null> => {
      if (!activeProject || !id.startsWith('local-')) return null;
      if (!isAuthenticated || isOfflineMode) return null;

      const localDoc =
        activeDocRef.current?.id === id
          ? activeDocRef.current
          : documents.find((d) => d.id === id);
      if (!localDoc) return null;

      try {
        const created = await api.documents.create({
          project_id: activeProject.id,
          title: localDoc.title,
          content_json: localDoc.content_json,
          plain_text: localDoc.plain_text,
        });

        const synced = documents.map((d) => (d.id === id ? created : d));
        setDocuments(synced);
        saveLocalDocuments(activeProject.id, synced);
        if (activeDocRef.current?.id === id) {
          setActiveDocumentState(created);
        }
        setSaveStatus('saved');
        return created;
      } catch {
        return null;
      }
    },
    [activeProject, documents, isAuthenticated, isOfflineMode, saveLocalDocuments]
  );

  const updateActiveDocument = async (updates: {
    title?: string;
    content_json?: Record<string, any>;
    plain_text?: string;
  }) => {
    const current = activeDocRef.current;
    if (!current || !activeProject) return;

    setSaveStatus('saving');

    const updatedDoc: DocumentItem = {
      ...current,
      title: updates.title ?? current.title,
      content_json: updates.content_json ?? current.content_json,
      plain_text: updates.plain_text ?? current.plain_text,
      updated_at: new Date().toISOString(),
    };

    setActiveDocumentState(updatedDoc);
    setDocuments((prev) => prev.map((d) => (d.id === current.id ? updatedDoc : d)));

    const localList = documents.map((d) => (d.id === current.id ? updatedDoc : d));
    saveLocalDocuments(activeProject.id, localList);

    if (isAuthenticated && !isOfflineMode && !current.id.startsWith('local-')) {
      try {
        await api.documents.update(current.id, updates);
        setSaveStatus('saved');
        return;
      } catch (err) {
        console.warn('Autosave to server failed, saved locally', err);
        setSaveStatus('offline');
        return;
      }
    }

    setSaveStatus(isOfflineMode ? 'offline' : 'saved');
  };

  const deleteDocument = async (id: string) => {
    if (!activeProject) return;
    const projectId = activeProject.id;

    if (isAuthenticated && !isOfflineMode && !id.startsWith('local-')) {
      try {
        await api.documents.delete(id);
      } catch (err) {
        console.warn('Could not delete document on server', err);
      }
    }

    const remaining = documents.filter((d) => d.id !== id);
    setDocuments(remaining);
    saveLocalDocuments(projectId, remaining);

    if (activeDocument?.id === id) {
      if (remaining.length > 0) {
        setActiveDocument(remaining[0]);
      } else {
        await createDocument();
      }
    }
  };

  const updateStats = (newStats: EditorStats) => {
    setStats(newStats);
  };

  // Phase 5: Handle citation inserted
  const handleCitationInserted = useCallback(
    async (paper: BibliographicReference) => {
      const doc = activeDocRef.current;
      if (!doc) return;

      const paperId = paper.paperId || paper.id;
      setRecentlyAddedRefId(paperId);
      setTimeout(() => setRecentlyAddedRefId(null), 1200);

      // Create new Citation item
      const newItem: CitationItem = {
        id: `cit-${paperId}-${Date.now()}`,
        documentId: doc.id,
        paperId: paperId,
        position: documentCitations.length + 1,
        citationStyle: citationStyle,
        attributionScope: 'sentence',
      };

      setDocumentCitations((prev) => [...prev, newItem]);

      if (isAuthenticated && !isOfflineMode && !doc.id.startsWith('local-')) {
        try {
          await api.citations.create(doc.id, {
            paper_id: paperId,
            citation_style: citationStyle,
            attribution_scope: 'sentence',
          });
          setToastMessage('Citation inserted & bibliography updated');
          setTimeout(() => setToastMessage(null), 3000);
        } catch (e) {
          setToastMessage('Citation saved locally only');
          setTimeout(() => setToastMessage(null), 3000);
        }
      } else {
        setToastMessage('Citation inserted & bibliography updated');
        setTimeout(() => setToastMessage(null), 3000);
      }
    },
    [citationStyle, documentCitations.length, isAuthenticated, isOfflineMode]
  );

  // Phase 5: Handle citation deleted with "Reference removed" toast (UI/UX §4.1)
  const handleCitationDeleted = useCallback(
    async (paperId: string) => {
      const doc = activeDocRef.current;
      if (!doc) return;

      setDocumentCitations((prev) => prev.filter((c) => c.paperId !== paperId));
      setToastMessage('Reference removed from bibliography');
      setTimeout(() => setToastMessage(null), 3000);
    },
    []
  );

  return (
    <DocumentContext.Provider
      value={{
        documents,
        activeDocument,
        isLoadingDocuments,
        saveStatus,
        stats,
        citationStyle,
        documentCitations,
        recentlyAddedRefId,
        toastMessage,
        setCitationStyle,
        setActiveDocument,
        createDocument,
        syncLocalDocument,
        updateActiveDocument,
        deleteDocument,
        updateStats,
        refreshDocuments,
        handleCitationInserted,
        handleCitationDeleted,
        clearToast,
      }}
    >
      {children}
    </DocumentContext.Provider>
  );
};

export const useDocument = () => {
  const context = useContext(DocumentContext);
  if (!context) {
    throw new Error('useDocument must be used within a DocumentProvider');
  }
  return context;
};
