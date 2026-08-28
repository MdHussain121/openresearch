'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { api, TeamDTO, TeamMemberDTO, TeamRole } from '../../lib/api';
import { getErrorMessage } from '../../lib/errors';
import { useAuth } from '../../context/AuthContext';
import { useProject } from '../../context/ProjectContext';
import { t } from '../../i18n';
import { ConfirmDialog } from './ConfirmDialog';
import {
  Users,
  Plus,
  Trash2,
  Mail,
  Check,
  AlertCircle,
  Building,
  Crown
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@openresearch/ui';

interface TeamModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const TeamModal: React.FC<TeamModalProps> = ({ isOpen, onClose }) => {
  const { user } = useAuth();
  const { refreshProjects } = useProject();

  const [teams, setTeams] = useState<TeamDTO[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<TeamDTO | null>(null);
  const [members, setMembers] = useState<TeamMemberDTO[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // New team form
  const [showCreateTeam, setShowCreateTeam] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamDesc, setNewTeamDesc] = useState('');

  // Invite member form
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<TeamRole>('editor');

  // Pending member removal confirmation
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);

  const loadTeams = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.teams.list();
      setTeams(data);
      if (data.length > 0 && !selectedTeam) {
        setSelectedTeam(data[0] || null);
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load teams'));
    } finally {
      setIsLoading(false);
    }
  }, [selectedTeam]);

  const loadMembers = useCallback(async (teamId: string) => {
    try {
      const mems = await api.teams.listMembers(teamId);
      setMembers(mems);
    } catch (err: unknown) {
      console.warn('Could not fetch team members', err);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadTeams();
    }
  }, [isOpen, loadTeams]);

  useEffect(() => {
    if (selectedTeam) {
      loadMembers(selectedTeam.id);
    }
  }, [selectedTeam, loadMembers]);

  const handleCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTeamName.trim()) return;
    setError(null);
    try {
      const created = await api.teams.create({
        name: newTeamName.trim(),
        description: newTeamDesc.trim() || undefined,
      });
      setTeams((prev) => [created, ...prev]);
      setSelectedTeam(created);
      setNewTeamName('');
      setNewTeamDesc('');
      setShowCreateTeam(false);
      setSuccessMsg(`Team "${created.name}" created successfully!`);
      await refreshProjects();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to create team workspace'));
    }
  };

  const handleInviteMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTeam || !inviteEmail.trim()) return;
    setError(null);
    try {
      await api.teams.addMember(selectedTeam.id, {
        email: inviteEmail.trim(),
        role: inviteRole,
      });
      setInviteEmail('');
      setSuccessMsg(`Member invited with ${inviteRole} role!`);
      await loadMembers(selectedTeam.id);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to add member to team'));
    }
  };

  const handleRoleChange = async (membershipId: string, newRole: TeamRole) => {
    if (!selectedTeam) return;
    try {
      await api.teams.updateMemberRole(selectedTeam.id, membershipId, { role: newRole });
      await loadMembers(selectedTeam.id);
      setSuccessMsg('Member role updated');
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not update role'));
    }
  };

  const handleRemoveMember = async (membershipId: string) => {
    if (!selectedTeam) return;
    try {
      await api.teams.removeMember(selectedTeam.id, membershipId);
      await loadMembers(selectedTeam.id);
      setSuccessMsg('Member removed from team');
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not remove member'));
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl p-0 flex flex-col max-h-[85vh] overflow-hidden">
        {/* Header */}
        <DialogHeader className="px-6 py-4">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-accent/10 text-accent rounded-lg">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="font-semibold text-lg">{t('teams.title')}</DialogTitle>
              <DialogDescription className="text-xs text-text-secondary">{t('teams.subtitle')}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Content Layout */}
        <div className="grid grid-cols-1 md:grid-cols-3 flex-1 overflow-hidden">
          {/* Left: Teams List */}
          <div className="border-r border-border-default bg-sunken/20 p-4 flex flex-col gap-2 overflow-y-auto">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                {t('teams.myTeams')}
              </span>
              <button
                type="button"
                onClick={() => setShowCreateTeam(true)}
                className="text-xs text-accent hover:text-accent-hover font-medium flex items-center gap-1 focus-visible:ring-2 focus-visible:ring-accent rounded"
              >
                <Plus className="w-3.5 h-3.5" />
                {t('teams.createTeam')}
              </button>
            </div>

            {teams.length === 0 && !isLoading && (
              <div className="text-center py-6 text-xs text-text-secondary">
                No team workspaces yet. Create one to collaborate!
              </div>
            )}

            {teams.map((tm) => (
              <button
                key={tm.id}
                type="button"
                onClick={() => {
                  setSelectedTeam(tm);
                  setShowCreateTeam(false);
                }}
                className={`w-full text-left p-3 rounded-lg border transition-[background-color,border-color,box-shadow] duration-150 text-xs flex flex-col gap-1 focus-visible:ring-2 focus-visible:ring-accent ${
                  selectedTeam?.id === tm.id && !showCreateTeam
                    ? 'border-accent bg-accent/5 text-text-primary font-medium'
                    : 'border-border-default bg-surface hover:bg-sunken/60 text-text-secondary'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-text-primary truncate">{tm.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-sunken text-text-secondary capitalize">
                    {tm.current_user_role}
                  </span>
                </div>
                {tm.description && (
                  <span className="text-[11px] text-text-secondary line-clamp-1">{tm.description}</span>
                )}
                <span className="text-[10px] text-text-tertiary">{tm.member_count} member(s)</span>
              </button>
            ))}
          </div>

          {/* Right: Team Details / Creation */}
          <div className="md:col-span-2 p-6 overflow-y-auto flex flex-col gap-5">
            {error && (
              <div className="p-3 bg-trust-danger/10 border border-trust-danger/30 rounded-lg text-xs text-trust-danger flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {successMsg && (
              <div className="p-3 bg-trust-success/10 border border-trust-success/30 rounded-lg text-xs text-trust-success flex items-center gap-2">
                <Check className="w-4 h-4 shrink-0" />
                <span>{successMsg}</span>
              </div>
            )}

            {showCreateTeam ? (
              /* Create Team Form */
              <form onSubmit={handleCreateTeam} className="flex flex-col gap-4">
                <h3 className="font-semibold text-sm text-text-primary flex items-center gap-2">
                  <Building className="w-4 h-4 text-accent" />
                  {t('teams.createTeam')}
                </h3>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">
                    {t('teams.teamName')}
                  </label>
                  <input
                    type="text"
                    required
                    value={newTeamName}
                    onChange={(e) => setNewTeamName(e.target.value)}
                    placeholder={t('teams.teamNamePlaceholder')}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-border-default bg-surface text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">
                    {t('teams.description')}
                  </label>
                  <textarea
                    rows={3}
                    value={newTeamDesc}
                    onChange={(e) => setNewTeamDesc(e.target.value)}
                    placeholder={t('teams.descriptionPlaceholder')}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-border-default bg-surface text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  />
                </div>
                <div className="flex justify-end gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => setShowCreateTeam(false)}
                    className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary rounded-lg border border-border-default focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1.5 text-xs bg-accent text-accent-solid-fg rounded-lg hover:bg-accent-hover font-medium focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {t('teams.createTeam')}
                  </button>
                </div>
              </form>
            ) : selectedTeam ? (
              /* Manage Selected Team */
              <div className="flex flex-col gap-6">
                <div className="border-b border-border-default pb-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-base text-text-primary flex items-center gap-2">
                        <Building className="w-4.5 h-4.5 text-accent" />
                        {selectedTeam.name}
                      </h3>
                      {selectedTeam.description && (
                        <p className="text-xs text-text-secondary mt-1">{selectedTeam.description}</p>
                      )}
                    </div>
                    <span className="text-xs px-2.5 py-1 rounded-full bg-accent/10 text-accent font-medium capitalize">
                      {selectedTeam.current_user_role}
                    </span>
                  </div>
                </div>

                {/* Invite Member Section (Only for owner) */}
                {selectedTeam.current_user_role === 'owner' && (
                  <form
                    onSubmit={handleInviteMember}
                    className="p-4 bg-sunken/30 border border-border-default rounded-xl flex flex-col gap-3"
                  >
                    <span className="text-xs font-semibold text-text-primary flex items-center gap-1.5">
                      <Mail className="w-3.5 h-3.5 text-accent" />
                      {t('teams.addMember')}
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <input
                        type="email"
                        required
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        placeholder={t('teams.memberEmailPlaceholder')}
                        className="sm:col-span-2 px-3 py-1.5 text-xs rounded-lg border border-border-default bg-surface text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      />
                      <select
                        value={inviteRole}
                        onChange={(e) => setInviteRole(e.target.value as TeamRole)}
                        className="px-2.5 py-1.5 text-xs rounded-lg border border-border-default bg-surface text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        <option value="editor">Editor</option>
                        <option value="viewer">Viewer</option>
                        <option value="owner">Owner</option>
                      </select>
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="submit"
                        className="px-3 py-1.5 text-xs bg-accent text-accent-solid-fg rounded-lg hover:bg-accent-hover font-medium flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        {t('teams.addMember')}
                      </button>
                    </div>
                  </form>
                )}

                {/* Members List */}
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
                    {t('teams.members')} ({members.length})
                  </span>
                  <div className="divide-y divide-border-default border border-border-default rounded-lg overflow-hidden bg-surface">
                    {members.map((m) => (
                      <div
                        key={m.id}
                        className="p-3 flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-accent/15 text-accent font-semibold flex items-center justify-center text-xs">
                            {(m.name || m.email || 'U')[0].toUpperCase()}
                          </div>
                          <div className="flex flex-col">
                            <span className="font-medium text-text-primary flex items-center gap-1.5">
                              {m.name || m.email}
                              {m.role === 'owner' && (
                                <Crown className="w-3 h-3 text-amber-500 shrink-0" />
                              )}
                            </span>
                            <span className="text-[11px] text-text-secondary">{m.email}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {selectedTeam.current_user_role === 'owner' && m.user_id !== user?.id ? (
                            <>
                              <select
                                value={m.role}
                                onChange={(e) => handleRoleChange(m.id, e.target.value as TeamRole)}
                                className="px-2 py-1 text-[11px] rounded border border-border-default bg-surface text-text-primary focus-visible:ring-2 focus-visible:ring-accent"
                              >
                                <option value="owner">Owner</option>
                                <option value="editor">Editor</option>
                                <option value="viewer">Viewer</option>
                              </select>
                              <button
                                type="button"
                                onClick={() => setPendingRemoveId(m.id)}
                                title="Remove member"
                                className="p-1 text-trust-danger hover:bg-trust-danger/10 rounded transition-colors focus-visible:ring-2 focus-visible:ring-accent"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          ) : (
                            <span className="text-[11px] px-2 py-0.5 rounded bg-sunken text-text-secondary capitalize">
                              {m.role}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-12 text-text-secondary text-xs">
                Select a team workspace on the left or create a new one.
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <DialogFooter className="px-6 py-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-xs rounded-lg border border-border-default text-text-secondary hover:text-text-primary transition-colors focus-visible:ring-2 focus-visible:ring-accent"
          >
            {t('common.close')}
          </button>
        </DialogFooter>

        <ConfirmDialog
          isOpen={pendingRemoveId !== null}
          title={t('teams.removeMemberTitle')}
          description={t('teams.removeConfirm')}
          onConfirm={() => {
            if (pendingRemoveId) {
              handleRemoveMember(pendingRemoveId);
            }
            setPendingRemoveId(null);
          }}
          onCancel={() => setPendingRemoveId(null)}
        />
      </DialogContent>
    </Dialog>
  );
};
