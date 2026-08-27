import { request } from './client';

export interface ProjectDTO {
  id: string;
  name: string;
  description?: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

export const projectsApi = {
  list: () => request<ProjectDTO[]>('/projects'),
  create: (data: { name: string; description?: string }) =>
    request<ProjectDTO>('/projects', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  get: (id: string) => request<ProjectDTO>(`/projects/${id}`),
  update: (id: string, data: { name?: string; description?: string }) =>
    request<ProjectDTO>(`/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    request<void>(`/projects/${id}`, {
      method: 'DELETE',
    }),
};
