'use client';

import React from 'react';
import { t } from '../../i18n';
import { AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Button,
} from '@openresearch/ui';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive = true,
  onConfirm,
  onCancel,
}) => {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-sm p-0 overflow-hidden" hideClose>
        <DialogHeader className="px-6 py-4">
          <div className="flex items-center space-x-2">
            <AlertTriangle className={`w-4 h-4 shrink-0 ${destructive ? 'text-trust-danger' : 'text-trust-warning'}`} />
            <DialogTitle className="font-serif font-bold text-base text-text-primary">{title}</DialogTitle>
          </div>
          {description && (
            <DialogDescription className="pt-1 pl-6 leading-relaxed">{description}</DialogDescription>
          )}
        </DialogHeader>

        <DialogFooter className="px-6 py-3">
          <Button variant="outline" size="sm" onClick={onCancel}>
            {cancelLabel ?? t('common.cancel')}
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            size="sm"
            autoFocus
            onClick={onConfirm}
          >
            {confirmLabel ?? t('common.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
