import { request } from './client';

export type TeamRole = 'owner' | 'editor' | 'viewer';

export interface TeamDTO {
  id: string;
  name: string;
  description?: string;
  created_by_user_id?: string;
  member_count?: number;
  current_user_role?: TeamRole;
  created_at: string;
}

export interface TeamMemberDTO {
  id: string;
  owner_id: string;
  user_id: string;
  role: TeamRole;
  name?: string;
  email?: string;
  user?: {
    id: string;
    name: string;
    email: string;
  };
  created_at: string;
}

export const teamsApi = {
  list: () => request<TeamDTO[]>('/teams'),
  get: (id: string) => request<TeamDTO>(`/teams/${id}`),
  create: (data: { name: string; description?: string }) =>
    request<TeamDTO>('/teams', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: string, data: { name?: string; description?: string }) =>
    request<TeamDTO>(`/teams/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    request<void>(`/teams/${id}`, {
      method: 'DELETE',
    }),
  listMembers: (teamId: string) => request<TeamMemberDTO[]>(`/teams/${teamId}/members`),
  addMember: (teamId: string, data: { email: string; role?: TeamRole }) =>
    request<TeamMemberDTO>(`/teams/${teamId}/members`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateMemberRole: (teamId: string, membershipId: string, data: { role: TeamRole }) =>
    request<TeamMemberDTO>(`/teams/${teamId}/members/${membershipId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  removeMember: (teamId: string, membershipId: string) =>
    request<void>(`/teams/${teamId}/members/${membershipId}`, {
      method: 'DELETE',
    }),
};
