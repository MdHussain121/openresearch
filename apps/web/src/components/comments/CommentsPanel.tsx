'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { api, CommentDTO } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { t } from '../../i18n';
import {
  MessageSquare,
  CheckCircle2,
  RotateCcw,
  Trash2,
  CornerDownRight,
  Send,
  X,
  Quote,
  Clock,
  Plus
} from 'lucide-react';

interface CommentsPanelProps {
  documentId: string;
  isOpen: boolean;
  onClose: () => void;
}

export const CommentsPanel: React.FC<CommentsPanelProps> = ({
  documentId,
  isOpen,
  onClose,
}) => {
  const { user, isAuthenticated } = useAuth();
  const [comments, setComments] = useState<CommentDTO[]>([]);
  const [filter, setFilter] = useState<'all' | 'active' | 'resolved'>('active');
  const [newCommentText, setNewCommentText] = useState('');
  const [replyTextMap, setReplyTextMap] = useState<Record<string, string>>({});
  const [activeReplyId, setActiveReplyId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  const handleClose = useCallback(() => {
    setIsClosing(true);
    setTimeout(() => {
      setIsClosing(false);
      onClose();
    }, 250); // matches --duration-emphasis (250ms)
  }, [onClose]);

  const loadComments = useCallback(async () => {
    if (!documentId) return;
    setIsLoading(true);
    try {
      const data = await api.comments.list(documentId, true);
      setComments(data);
    } catch (err) {
      console.warn('Could not load comments', err);
    } finally {
      setIsLoading(false);
    }
  }, [documentId]);

  useEffect(() => {
    if (isOpen && documentId) {
      loadComments();
    }
  }, [isOpen, documentId, loadComments]);

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCommentText.trim()) return;
    try {
      await api.comments.create(documentId, {
        content: newCommentText.trim(),
      });
      setNewCommentText('');
      await loadComments();
    } catch (err) {
      console.warn('Could not add comment', err);
    }
  };

  const handleReply = async (commentId: string) => {
    const text = replyTextMap[commentId];
    if (!text || !text.trim()) return;
    try {
      await api.comments.reply(documentId, commentId, {
        content: text.trim(),
      });
      setReplyTextMap((prev) => ({ ...prev, [commentId]: '' }));
      setActiveReplyId(null);
      await loadComments();
    } catch (err) {
      console.warn('Could not add reply', err);
    }
  };

  const handleToggleResolve = async (commentId: string, currentResolved: boolean) => {
    try {
      await api.comments.update(documentId, commentId, {
        resolved: !currentResolved,
      });
      await loadComments();
    } catch (err) {
      console.warn('Could not update resolved state', err);
    }
  };

  const handleDelete = async (commentId: string) => {
    try {
      await api.comments.delete(documentId, commentId);
      await loadComments();
    } catch (err) {
      console.warn('Could not delete comment', err);
    }
  };

  if (!isOpen && !isClosing) return null;

  const filteredComments = comments.filter((c) => {
    if (filter === 'active') return !c.resolved;
    if (filter === 'resolved') return c.resolved;
    return true;
  });

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-10 bg-black/5 transition-opacity duration-150 ease-smooth-out data-[state=open]:opacity-100 data-[state=closed]:opacity-0 backdrop-enter" data-state={isClosing ? 'closed' : 'open'} onClick={handleClose} aria-hidden="true" />
      <div className="w-80 border-l border-border bg-surface flex flex-col h-full z-20 shadow-lg transition-[transform,opacity] duration-350 ease-smooth-out data-[state=open]:translate-x-0 data-[state=open]:opacity-100 data-[state=closed]:translate-x-full data-[state=closed]:opacity-0 data-[state=closed]:duration-150 data-[state=closed]:ease-out drawer-enter" data-state={isClosing ? 'closed' : 'open'}>
      {/* Header */}
      <div className="p-4 border-b border-border flex items-center justify-between bg-sunken/30">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-accent" />
          <h3 className="font-semibold text-xs text-primary">{t('collaboration.comments')}</h3>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent/10 text-accent font-medium">
            {comments.filter((c) => !c.resolved).length}
          </span>
        </div>
        <button
          onClick={handleClose}
          className="p-1 text-secondary hover:text-primary rounded hover:bg-sunken transition-colors"
          aria-label={t('common.close')}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="flex border-b border-border text-[11px] bg-sunken/10">
        <button
          onClick={() => setFilter('active')}
          className={`flex-1 py-1.5 font-medium border-b-2 transition-[border-color,color] duration-150 ${
            filter === 'active'
              ? 'border-accent text-accent'
              : 'border-transparent text-secondary hover:text-primary'
          }`}
        >
          Active ({comments.filter((c) => !c.resolved).length})
        </button>
        <button
          onClick={() => setFilter('resolved')}
          className={`flex-1 py-1.5 font-medium border-b-2 transition-[border-color,color] duration-150 ${
            filter === 'resolved'
              ? 'border-accent text-accent'
              : 'border-transparent text-secondary hover:text-primary'
          }`}
        >
          Resolved ({comments.filter((c) => c.resolved).length})
        </button>
        <button
          onClick={() => setFilter('all')}
          className={`flex-1 py-1.5 font-medium border-b-2 transition-[border-color,color] duration-150 ${
            filter === 'all'
              ? 'border-accent text-accent'
              : 'border-transparent text-secondary hover:text-primary'
          }`}
        >
          All
        </button>
      </div>

      {/* Comments List */}
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
        {filteredComments.length === 0 && !isLoading && (
          <div className="text-center py-10 text-secondary text-xs">
            {t('collaboration.noComments')}
          </div>
        )}

        {isLoading && (
          <>
            {[0,1,2].map((i) => (
              <div key={`sk-${i}`} className="p-3 rounded-lg border border-border bg-surface flex flex-col gap-2 skeleton">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <div className="w-5 h-5 rounded-full bg-sunken animate-pulse" />
                    <div className="h-3 w-20 bg-sunken rounded animate-pulse" />
                  </div>
                  <div className="h-2 w-12 bg-sunken rounded animate-pulse" />
                </div>
                <div className="h-3 w-full bg-sunken rounded animate-pulse" />
                <div className="h-3 w-3/4 bg-sunken rounded animate-pulse" />
              </div>
            ))}
          </>
        )}
        {filteredComments.map((comment, idx) => (
          <div
            key={comment.id}
            style={{ animationDelay: `${Math.min(idx * 40, 240)}ms` }}
            className={`p-3 rounded-lg border text-xs flex flex-col gap-2 transition-[transform,border-color,opacity] duration-150 ease-smooth-out animate-fade-slide-in ${
              comment.resolved
                ? 'bg-sunken/20 border-border opacity-75'
                : 'bg-surface border-border hover:border-accent/40 shadow-xs'
            }`}
          >
            {/* Quote snippet if attached to selection */}
            {comment.selected_text && (
              <div className="border-l-2 border-accent/40 pl-2 text-[11px] text-secondary italic line-clamp-2 bg-sunken/40 py-1 rounded-r">
                &quot;{comment.selected_text}&quot;
              </div>
            )}

            {/* Author info & actions */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <div className="w-5 h-5 rounded-full bg-accent/15 text-accent font-semibold flex items-center justify-center text-[10px]">
                  {(comment.author_name || 'U')[0].toUpperCase()}
                </div>
                <span className="font-semibold text-primary">{comment.author_name}</span>
              </div>
              <span className="text-[10px] text-tertiary">
                {new Date(comment.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>

            {/* Comment Body */}
            <p className="text-primary leading-relaxed whitespace-pre-wrap">{comment.content}</p>

            {/* Threaded replies */}
            {comment.replies && comment.replies.length > 0 && (
              <div className="pl-3 border-l border-border flex flex-col gap-2 my-1">
                {comment.replies.map((reply: CommentDTO) => (
                  <div key={reply.id} className="flex flex-col gap-0.5 text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-primary">{reply.author_name}</span>
                      <span className="text-[9px] text-tertiary">
                        {new Date(reply.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-secondary leading-normal">{reply.content}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Actions bar */}
            <div className="flex items-center justify-between pt-1 border-t border-border/50 text-[11px]">
              <button
                onClick={() =>
                  setActiveReplyId(activeReplyId === comment.id ? null : comment.id)
                }
                className="text-accent hover:text-accent-hover font-medium flex items-center gap-1"
              >
                <CornerDownRight className="w-3 h-3" />
                {t('collaboration.reply')}
              </button>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleToggleResolve(comment.id, comment.resolved)}
                  className="text-secondary hover:text-primary flex items-center gap-1"
                  title={comment.resolved ? t('collaboration.reopen') : t('collaboration.resolve')}
                  aria-label={comment.resolved ? t('collaboration.reopen') : t('collaboration.resolve')}
                >
                  <CheckCircle2
                    className={`w-3.5 h-3.5 ${
                      comment.resolved ? 'text-green-600' : 'text-secondary'
                    }`}
                  />
                  <span>{comment.resolved ? t('collaboration.reopen') : t('collaboration.resolve')}</span>
                </button>

                <button
                  onClick={() => handleDelete(comment.id)}
                  className="text-secondary hover:text-red-500 p-0.5"
                  title="Delete thread"
                  aria-label="Delete thread"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>

            {/* Reply Input */}
            {activeReplyId === comment.id && (
              <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-border animate-in fade-in slide-in-from-top-1 duration-150">
                <input
                  type="text"
                  placeholder={t('collaboration.typeReply')}
                  value={replyTextMap[comment.id] || ''}
                  onChange={(e) =>
                    setReplyTextMap({ ...replyTextMap, [comment.id]: e.target.value })
                  }
                  onKeyDown={(e) => e.key === 'Enter' && handleReply(comment.id)}
                  aria-label={t('collaboration.typeReply')}
                  className="flex-1 px-2 py-1 text-xs rounded border border-border bg-surface text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                />
                <button
                  onClick={() => handleReply(comment.id)}
                  className="p-1 bg-accent text-accent-solid-fg rounded hover:bg-accent-hover"
                  aria-label={t('collaboration.reply')}
                >
                  <Send className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add New Comment Input */}
      <form onSubmit={handleAddComment} className="p-3 border-t border-border bg-sunken/20 flex gap-2">
        <input
          type="text"
          placeholder={t('collaboration.typeComment')}
          value={newCommentText}
          onChange={(e) => setNewCommentText(e.target.value)}
          aria-label={t('collaboration.typeComment')}
          className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-border bg-surface text-primary focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <button
          type="submit"
          disabled={!newCommentText.trim()}
          className="px-3 py-1.5 bg-accent text-accent-solid-fg text-xs rounded-lg hover:bg-accent-hover font-medium disabled:opacity-50 flex items-center gap-1"
        >
          <Plus className="w-3.5 h-3.5" />
          {t('common.save')}
        </button>
      </form>
    </div>
    </>
  );
};
