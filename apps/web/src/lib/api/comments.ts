import { request } from './client';

export interface CommentDTO {
  id: string;
  document_id: string;
  user_id: string;
  author_name: string;
  parent_id?: string | null;
  selected_text?: string | null;
  from_pos?: number | null;
  to_pos?: number | null;
  content: string;
  resolved: boolean;
  created_at: string;
  updated_at: string;
  replies?: CommentDTO[] | null;
}

export const commentsApi = {
  list: (documentId: string, includeResolved: boolean = true) =>
    request<CommentDTO[]>(`/documents/${documentId}/comments?include_resolved=${includeResolved}`),
  create: (
    documentId: string,
    data: {
      selected_text?: string;
      from_pos?: number;
      to_pos?: number;
      content: string;
      parent_id?: string;
    }
  ) =>
    request<CommentDTO>(`/documents/${documentId}/comments`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  reply: (documentId: string, commentId: string, data: { content: string }) =>
    request<CommentDTO>(`/documents/${documentId}/comments/${commentId}/replies`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (documentId: string, commentId: string, data: { content?: string; resolved?: boolean }) =>
    request<CommentDTO>(`/documents/${documentId}/comments/${commentId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  delete: (documentId: string, commentId: string) =>
    request<void>(`/documents/${documentId}/comments/${commentId}`, {
      method: 'DELETE',
    }),
};
