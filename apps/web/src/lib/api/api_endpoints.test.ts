import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  api,
  papersApi,
  citationsApi,
  documentsApi,
  projectsApi,
  commentsApi,
  versionsApi,
  graphsApi,
  intelligenceApi,
  providersApi,
  pluginsApi,
  researchApi,
  ragApi,
  systemApi,
  zoteroApi,
  exportApi,
} from './index';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Web API Modules Client Endpoints', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('projectsApi', () => {
    it('calls list, get, create, update, and delete', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse([{ id: 'p1', name: 'Project 1' }]))
        .mockResolvedValueOnce(jsonResponse({ id: 'p1', name: 'Project 1' }))
        .mockResolvedValueOnce(jsonResponse({ id: 'p2', name: 'New Project' }))
        .mockResolvedValueOnce(jsonResponse({ id: 'p1', name: 'Updated' }))
        .mockResolvedValueOnce(new Response(null, { status: 204 }));
      vi.stubGlobal('fetch', fetchMock);

      const list = await projectsApi.list();
      expect(list).toHaveLength(1);

      const proj = await projectsApi.get('p1');
      expect(proj.name).toBe('Project 1');

      const created = await projectsApi.create({ name: 'New Project', description: 'Desc' });
      expect(created.id).toBe('p2');

      const updated = await projectsApi.update('p1', { name: 'Updated' });
      expect(updated.name).toBe('Updated');

      await projectsApi.delete('p1');
      expect(fetchMock).toHaveBeenCalledTimes(5);
    });
  });

  describe('documentsApi', () => {
    it('calls list, get, create, update, and delete', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse([{ id: 'doc-1', title: 'Draft' }]))
        .mockResolvedValueOnce(jsonResponse({ id: 'doc-1', title: 'Draft' }))
        .mockResolvedValueOnce(jsonResponse({ id: 'doc-2', title: 'Doc 2' }))
        .mockResolvedValueOnce(jsonResponse({ id: 'doc-1', title: 'Renamed' }))
        .mockResolvedValueOnce(new Response(null, { status: 204 }));
      vi.stubGlobal('fetch', fetchMock);

      const list = await documentsApi.list('proj-1');
      expect(list).toHaveLength(1);

      const doc = await documentsApi.get('doc-1');
      expect(doc.title).toBe('Draft');

      const created = await documentsApi.create({ project_id: 'proj-1', title: 'Doc 2' });
      expect(created.id).toBe('doc-2');

      const updated = await documentsApi.update('doc-1', { title: 'Renamed' });
      expect(updated.title).toBe('Renamed');

      await documentsApi.delete('doc-1');
      expect(fetchMock).toHaveBeenCalledTimes(5);
    });
  });

  describe('papersApi', () => {
    it('calls list, get, status, delete, annotations, and ask', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse([{ id: 'paper-1', title: 'Paper 1' }]))
        .mockResolvedValueOnce(jsonResponse({ id: 'paper-1', title: 'Paper 1' }))
        .mockResolvedValueOnce(jsonResponse({ id: 'paper-1', extraction_status: 'ok' }))
        .mockResolvedValueOnce(jsonResponse([{ id: 'anno-1', selected_text: 'Text' }]))
        .mockResolvedValueOnce(jsonResponse({ id: 'anno-2', selected_text: 'Highlight' }))
        .mockResolvedValueOnce(jsonResponse({ id: 'anno-2', note_text: 'Updated Note' }))
        .mockResolvedValueOnce(new Response(null, { status: 204 }))
        .mockResolvedValueOnce(jsonResponse({ answer: '42', prompt_type: 'summary' }))
        .mockResolvedValueOnce(new Response(null, { status: 204 }));
      vi.stubGlobal('fetch', fetchMock);

      const list = await papersApi.list('proj-1', 'deep learning');
      expect(list).toHaveLength(1);

      const paper = await papersApi.get('paper-1');
      expect(paper.id).toBe('paper-1');

      const status = await papersApi.status('paper-1');
      expect(status.extraction_status).toBe('ok');

      const annos = await papersApi.getAnnotations('paper-1');
      expect(annos).toHaveLength(1);

      const newAnno = await papersApi.createAnnotation('paper-1', {
        page_number: 1,
        selected_text: 'Highlight',
      });
      expect(newAnno.id).toBe('anno-2');

      const updatedAnno = await papersApi.updateAnnotation('paper-1', 'anno-2', {
        note_text: 'Updated Note',
      });
      expect(updatedAnno.note_text).toBe('Updated Note');

      await papersApi.deleteAnnotation('paper-1', 'anno-2');

      const askRes = await papersApi.ask('paper-1', { question: 'What is this paper about?' });
      expect(askRes.answer).toBe('42');

      await papersApi.delete('paper-1');
      expect(fetchMock).toHaveBeenCalledTimes(9);
    });
  });

  describe('citationsApi', () => {
    it('calls list, create, delete, resolveIdentifier, and addByIdentifier', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse([{ id: 'cite-1', paper_id: 'p1' }]))
        .mockResolvedValueOnce(jsonResponse({ id: 'cite-2', paper_id: 'p2' }))
        .mockResolvedValueOnce(new Response(null, { status: 204 }))
        .mockResolvedValueOnce(
          jsonResponse({ identifier: '10.1234/test', id_type: 'doi', title: 'Resolved Title' })
        )
        .mockResolvedValueOnce(jsonResponse({ id: 'p3', title: 'Added Paper' }))
        .mockResolvedValueOnce(jsonResponse({ total_imported: 1, papers: [] }))
        .mockResolvedValueOnce(jsonResponse({ bibtex_content: '@article{...}', total_entries: 1 }))
        .mockResolvedValueOnce(jsonResponse({ bibtex_content: '@article{...}', total_entries: 1 }));
      vi.stubGlobal('fetch', fetchMock);

      const cites = await citationsApi.list('doc-1');
      expect(cites).toHaveLength(1);

      const created = await citationsApi.create('doc-1', { paper_id: 'p2', position: 10 });
      expect(created.id).toBe('cite-2');

      await citationsApi.delete('doc-1', 'cite-2');

      const resolved = await citationsApi.resolveIdentifier('10.1234/test');
      expect(resolved.title).toBe('Resolved Title');

      const added = await citationsApi.addByIdentifier('proj-1', '10.1234/test');
      expect(added.id).toBe('p3');

      const imported = await citationsApi.importBibtex('proj-1', '@article{...}');
      expect(imported.total_imported).toBe(1);

      const projBib = await citationsApi.exportProjectBibtex('proj-1');
      expect(projBib.total_entries).toBe(1);

      const docBib = await citationsApi.exportDocumentBibtex('doc-1');
      expect(docBib.total_entries).toBe(1);
    });
  });

  describe('commentsApi & versionsApi', () => {
    it('calls comments and version history endpoints', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse([{ id: 'c1', content: 'Good point' }]))
        .mockResolvedValueOnce(jsonResponse({ id: 'c2', content: 'New comment' }))
        .mockResolvedValueOnce(jsonResponse({ id: 'c1', resolved: true }))
        .mockResolvedValueOnce(new Response(null, { status: 204 }))
        .mockResolvedValueOnce(jsonResponse([{ id: 'v1', version_number: 1 }]))
        .mockResolvedValueOnce(jsonResponse({ id: 'v2', version_number: 2 }))
        .mockResolvedValueOnce(jsonResponse({ id: 'v1', restored: true }));
      vi.stubGlobal('fetch', fetchMock);

      const comments = await commentsApi.list('doc-1');
      expect(comments).toHaveLength(1);

      const newComment = await commentsApi.create('doc-1', { content: 'New comment' });
      expect(newComment.id).toBe('c2');

      const resolvedComment = await commentsApi.update('doc-1', 'c1', { resolved: true });
      expect(resolvedComment.resolved).toBe(true);

      await commentsApi.delete('doc-1', 'c1');

      const versions = await versionsApi.list('doc-1');
      expect(versions).toHaveLength(1);

      const snapshot = await versionsApi.create('doc-1', { change_summary: 'Snapshot 2' });
      expect(snapshot.id).toBe('v2');

      const restored = await versionsApi.restore('doc-1', 'v1');
      expect(restored.id).toBe('v1');
    });
  });

  describe('intelligenceApi & graphsApi & researchApi & systemApi', () => {
    it('calls intelligence, graph, research, and system endpoints', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ overall_score: 85, document_title: 'Title' }))
        .mockResolvedValueOnce(jsonResponse({ headers: [], rows: [] }))
        .mockResolvedValueOnce(jsonResponse({ claims: [] }))
        .mockResolvedValueOnce(jsonResponse({ potential_gaps: [] }))
        .mockResolvedValueOnce(jsonResponse({ nodes: [], edges: [] }))
        .mockResolvedValueOnce(jsonResponse({ query: 'neural networks', sources: [] }))
        .mockResolvedValueOnce(jsonResponse({ providers: [], total_cached_queries: 0, overall_cache_hit_rate: 1.0, notice: '' }));
      vi.stubGlobal('fetch', fetchMock);

      const review = await intelligenceApi.paperReview('proj-1', { document_id: 'doc-1' });
      expect(review.overall_score).toBe(85);

      const matrix = await intelligenceApi.literatureMatrix('proj-1', { paper_ids: ['p1'] });
      expect(matrix.rows).toEqual([]);

      const verification = await intelligenceApi.verifyClaims('proj-1', { text: 'Some claim' });
      expect(verification.claims).toEqual([]);

      const gaps = await intelligenceApi.researchGaps('proj-1', {});
      expect(gaps.potential_gaps).toEqual([]);

      const graph = await graphsApi.getResearchGraph('proj-1');
      expect(graph.nodes).toEqual([]);

      const search = await researchApi.search({ q: 'neural networks' });
      expect(search.query).toBe('neural networks');

      const status = await systemApi.getProviderStatus();
      expect(status.providers).toEqual([]);
    });
  });
});
