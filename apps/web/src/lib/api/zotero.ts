import { request } from './client';
import type { PaperDTO } from './papers';

export interface ZoteroImportResponseDTO {
  total_imported: number;
  papers: PaperDTO[];
  skipped_count: number;
  message: string;
}

export interface ZoteroSyncResponseDTO {
  synced_items_count: number;
  new_papers: PaperDTO[];
  last_synced_version: number;
}

export const zoteroApi = {
  import: (
    projectId: string,
    data: { api_key?: string; user_id?: string; collection_id?: string; csl_json_content?: string }
  ) =>
    request<ZoteroImportResponseDTO>(`/projects/${projectId}/zotero/import`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  sync: (projectId: string, data: { api_key: string; user_id: string; collection_id?: string }) =>
    request<ZoteroSyncResponseDTO>(`/projects/${projectId}/zotero/sync`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};
