import { request, resolveApiUrl, ApiError, extractErrorMessage } from './client';
import type { Author, ExtractionStatus } from '@openresearch/citations';

export interface PaperDTO {
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
  metadata_json?: Record<string, unknown>;
  created_at: string;
  updated_at?: string;
}

export interface PaperAnnotationDTO {
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

export interface PaperUploadResponseDTO extends PaperDTO {
  indexed_chunks?: number;
}

export interface PaperStatusDTO {
  id: string;
  title: string;
  extraction_status: ExtractionStatus;
  chunks_count?: number;
  annotations_count: number;
}

export const papersApi = {
  list: (projectId: string, query?: string) => {
    const q = query ? `?q=${encodeURIComponent(query)}` : '';
    return request<PaperDTO[]>(`/projects/${projectId}/papers${q}`);
  },
  get: (id: string) => request<PaperDTO>(`/papers/${id}`),
  upload: async (projectId: string, file: File): Promise<PaperUploadResponseDTO> => {
    const formData = new FormData();
    formData.append('file', file);

    const url = resolveApiUrl();
    const response = await fetch(`${url}/projects/${projectId}/papers/upload`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new ApiError(
        await extractErrorMessage(response, 'Paper upload failed'),
        response.status
      );
    }

    return response.json();
  },
  status: (id: string) => request<PaperStatusDTO>(`/papers/${id}/status`),
  delete: (id: string) =>
    request<void>(`/papers/${id}`, {
      method: 'DELETE',
    }),
  getAnnotations: (paperId: string) => request<PaperAnnotationDTO[]>(`/papers/${paperId}/annotations`),
  createAnnotation: (
    paperId: string,
    data: {
      page_number: number;
      selected_text: string;
      highlight_color?: string;
      note_text?: string;
      position_data?: Record<string, unknown>;
    }
  ) =>
    request<PaperAnnotationDTO>(`/papers/${paperId}/annotations`, {
      method: 'POST',
      body: JSON.stringify({ paper_id: paperId, ...data }),
    }),
  updateAnnotation: (
    paperId: string,
    annotationId: string,
    data: {
      highlight_color?: string;
      note_text?: string;
      ai_thread?: Array<{ role: 'user' | 'assistant'; message: string; timestamp: string }>;
    }
  ) =>
    request<PaperAnnotationDTO>(`/papers/${paperId}/annotations/${annotationId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteAnnotation: (paperId: string, annotationId: string) =>
    request<void>(`/papers/${paperId}/annotations/${annotationId}`, {
      method: 'DELETE',
    }),
  ask: (paperId: string, data: { selected_text?: string; page_number?: number; question?: string; prompt_type?: string }) =>
    request<{ answer: string; prompt_type: string; grounded?: boolean; sources?: string[] }>(`/papers/${paperId}/ask`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};
