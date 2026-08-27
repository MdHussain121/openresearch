import { request } from './client';
import type { JSONContent } from '@tiptap/core';

export interface DocumentVersionDTO {
  id: string;
  document_id: string;
  version_number: number;
  user_id?: string | null;
  author_name: string;
  title: string;
  content_json?: JSONContent | Record<string, unknown> | null;
  plain_text?: string | null;
  change_summary?: string | null;
  created_at: string;
}

export interface VersionDiffDTO {
  v1_id: string;
  v2_id: string;
  v1_version: number;
  v2_version: number;
  diff_summary: string;
  diff_items: Array<{ change_type: string; text: string }>;
}

export const versionsApi = {
  list: (documentId: string) => request<DocumentVersionDTO[]>(`/documents/${documentId}/versions`),
  create: (
    documentId: string,
    data: {
      title?: string;
      content_json?: JSONContent | Record<string, unknown>;
      plain_text?: string;
      change_summary?: string;
    }
  ) =>
    request<DocumentVersionDTO>(`/documents/${documentId}/versions`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  get: (documentId: string, versionId: string) =>
    request<DocumentVersionDTO>(`/documents/${documentId}/versions/${versionId}`),
  restore: (documentId: string, versionId: string) =>
    request<DocumentVersionDTO>(`/documents/${documentId}/versions/${versionId}/restore`, {
      method: 'POST',
    }),
  diff: (documentId: string, v1Id: string, v2Id: string) =>
    request<VersionDiffDTO>(`/documents/${documentId}/versions/${v1Id}/diff/${v2Id}`),
};
