import { request } from './client';
import type { JSONContent } from '@tiptap/core';

export interface DocumentDTO {
  id: string;
  project_id: string;
  title: string;
  content_json?: JSONContent | Record<string, unknown>;
  plain_text?: string;
  version?: number;
  created_at: string;
  updated_at: string;
}

export const documentsApi = {
  list: (projectId: string) => request<DocumentDTO[]>(`/projects/${projectId}/documents`),
  get: (id: string) => request<DocumentDTO>(`/documents/${id}`),
  create: (data: { project_id: string; title: string; content_json?: JSONContent | Record<string, unknown>; plain_text?: string }) =>
    request<DocumentDTO>('/documents', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: string, data: { title?: string; content_json?: JSONContent | Record<string, unknown>; plain_text?: string; version?: number }) =>
    request<DocumentDTO>(`/documents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    request<void>(`/documents/${id}`, {
      method: 'DELETE',
    }),
};
