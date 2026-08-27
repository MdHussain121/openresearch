'use client';

import React, { useState } from 'react';
import { useProject } from '../../context/ProjectContext';
import { getErrorMessage } from '../../lib/errors';
import { t } from '../../i18n';
import { FolderPlus, AlertCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@openresearch/ui';

interface ProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ProjectModal: React.FC<ProjectModalProps> = ({ isOpen, onClose }) => {
  const { createProject } = useProject();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Please provide a project name');
      return;
    }
    setError(null);
    setLoading(true);

    try {
      await createProject(name.trim(), description.trim() || undefined);
      setName('');
      setDescription('');
      onClose();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to create project'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md p-0 overflow-hidden">
        <DialogHeader className="px-6 py-4">
          <div className="flex items-center space-x-2">
            <FolderPlus className="w-4 h-4 text-accent" />
            <DialogTitle className="font-serif font-bold text-base text-text-primary">
              {t('project.newProject')}
            </DialogTitle>
          </div>
          <DialogDescription className="sr-only">Create a new academic research project</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 rounded bg-trust-warning/10 border border-trust-warning/30 flex items-start space-x-2 text-trust-warning text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-1">
            <label htmlFor="project-name" className="text-xs font-medium text-text-secondary">{t('project.projectName')}</label>
            <input
              id="project-name"
              type="text"
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('project.projectNamePlaceholder')}
              className="w-full px-3 py-2 text-sm rounded border border-border-default bg-canvas text-text-primary placeholder:text-text-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-text-secondary">{t('project.projectDescription')}</label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('project.projectDescriptionPlaceholder')}
              className="w-full px-3 py-2 text-sm rounded border border-border-default bg-canvas text-text-primary placeholder:text-text-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent resize-none"
            />
          </div>

          <div className="flex justify-end space-x-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs rounded border border-border-default text-text-secondary hover:bg-sunken transition-colors focus-visible:ring-2 focus-visible:ring-accent"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 text-xs rounded bg-accent text-accent-solid-fg font-medium hover:bg-accent-hover transition-colors disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-accent"
            >
              {loading ? t('common.loading') : t('project.createProject')}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
