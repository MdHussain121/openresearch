// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { getErrorMessage } from './errors';
import { copyWithFallback } from './clipboard';
import { paperToBibRef } from './paperToBibRef';
import { CITATION_STYLES } from './citationStyles';

describe('Web Lib Utilities', () => {
  describe('errors.ts: getErrorMessage', () => {
    it('extracts message from Error object', () => {
      expect(getErrorMessage(new Error('Test error'))).toBe('Test error');
    });

    it('returns string error directly', () => {
      expect(getErrorMessage('Raw string error')).toBe('Raw string error');
    });

    it('extracts message from object with message property', () => {
      expect(getErrorMessage({ message: 'Object error msg' })).toBe('Object error msg');
    });

    it('returns fallback for unknown or empty errors', () => {
      expect(getErrorMessage(null)).toBe('An unexpected error occurred');
      expect(getErrorMessage(undefined, 'Custom fallback')).toBe('Custom fallback');
      expect(getErrorMessage(12345, 'Custom fallback')).toBe('Custom fallback');
      expect(getErrorMessage({ other: 123 }, 'Custom fallback')).toBe('Custom fallback');
    });
  });

  describe('clipboard.ts: copyWithFallback', () => {
    it('uses navigator.clipboard.writeText in secure context', async () => {
      const writeTextMock = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: writeTextMock },
        configurable: true,
      });

      const success = await copyWithFallback('Hello World');
      expect(success).toBe(true);
      expect(writeTextMock).toHaveBeenCalledWith('Hello World');
    });

    it('falls back to textarea execCommand when navigator.clipboard fails', async () => {
      Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
      document.execCommand = vi.fn().mockReturnValue(true);

      const success = await copyWithFallback('Fallback Copy');
      expect(success).toBe(true);
      expect(document.execCommand).toHaveBeenCalledWith('copy');
    });
  });

  describe('paperToBibRef.ts', () => {
    it('transforms Paper to BibliographicReference with complete fields', () => {
      const paper = {
        id: 'paper-123',
        project_id: 'proj-1',
        title: 'Deep Residual Learning for Image Recognition',
        authors: [{ familyName: 'He', givenName: 'Kaiming' }],
        year: 2016,
        doi: '10.1109/CVPR.2016.90',
        abstract: 'Deeper neural networks are more difficult to train.',
        extraction_status: 'ok' as const,
        metadata_json: {
          journal: 'CVPR',
          publisher: 'IEEE',
        },
        created_at: '2026-01-01T00:00:00Z',
      };

      const ref = paperToBibRef(paper);
      expect(ref.id).toBe('paper-123');
      expect(ref.title).toBe('Deep Residual Learning for Image Recognition');
      expect(ref.authors).toEqual([{ familyName: 'He', givenName: 'Kaiming' }]);
      expect(ref.year).toBe(2016);
      expect(ref.doi).toBe('10.1109/CVPR.2016.90');
      expect(ref.journal).toBe('CVPR');
      expect(ref.publisher).toBe('IEEE');
      expect(ref.abstract).toBe('Deeper neural networks are more difficult to train.');
      expect(ref.extractionStatus).toBe('ok');
    });

    it('applies defaults when title and authors are missing', () => {
      const paper = {
        id: 'paper-empty',
        project_id: 'proj-1',
        title: '',
        extraction_status: 'unverified' as const,
        created_at: '2026-01-01T00:00:00Z',
      };

      const ref = paperToBibRef(paper);
      expect(ref.title).toBe('Untitled');
      expect(ref.authors).toEqual([{ familyName: 'Unknown' }]);
      expect(ref.journal).toBeUndefined();
      expect(ref.publisher).toBeUndefined();
    });
  });

  describe('citationStyles.ts', () => {
    it('contains all standard academic styles', () => {
      const ids = CITATION_STYLES.map((s) => s.id);
      expect(ids).toContain('apa');
      expect(ids).toContain('mla');
      expect(ids).toContain('chicago');
      expect(ids).toContain('ieee');
      expect(ids).toContain('harvard');
      expect(ids).toContain('vancouver');
      expect(ids).toContain('nature');
      expect(ids).toContain('science');
      expect(ids.length).toBeGreaterThanOrEqual(25);
    });
  });
});
