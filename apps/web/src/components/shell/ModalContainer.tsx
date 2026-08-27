'use client';

import React from 'react';
import { ProjectModal } from '../modals/ProjectModal';
import { ShortcutsModal } from '../modals/ShortcutsModal';
import { GlobalSearchModal } from '../modals/GlobalSearchModal';
import { AddByIdentifierModal } from '../modals/AddByIdentifierModal';
import { BibtexModal } from '../modals/BibtexModal';
import { AiOutlineModal } from '../modals/AiOutlineModal';
import { ExportModal } from '../modals/ExportModal';
import { ZoteroImportModal } from '../modals/ZoteroImportModal';
import { ProviderQuotaModal } from '../modals/ProviderQuotaModal';
import { TeamModal } from '../modals/TeamModal';
import { VersionHistoryModal } from '../modals/VersionHistoryModal';
import { PluginManagerModal } from '../modals/PluginManagerModal';
import { useDocument } from '../../context/DocumentContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import { api } from '../../lib/api';

/**
 * Global modal host. Modal open/close state lives in WorkspaceContext so any
 * route can trigger a modal; the document data comes straight from
 * DocumentContext. Rendered once by the persistent WorkspaceLayout.
 */
export const ModalContainer: React.FC = () => {
  const {
    activeDocument,
    stats,
    citationStyle,
    documentCitations,
    setActiveDocument,
    handleCitationInserted,
  } = useDocument();
  const w = useWorkspace();
  const m = w.modals;

  return (
    <>
      <ProjectModal isOpen={m.isProjectOpen} onClose={m.closeProject} />
      <ShortcutsModal isOpen={m.isShortcutsOpen} onClose={m.closeShortcuts} />
      <AddByIdentifierModal
        isOpen={m.isAddByIdentifierOpen}
        onClose={m.closeAddByIdentifier}
        onCitePaper={(paper) => {
          handleCitationInserted(paper);
          w.navigate('documents');
        }}
      />
      <BibtexModal isOpen={m.isBibtexOpen} onClose={m.closeBibtex} defaultTab={m.bibtexTab} />
      <GlobalSearchModal
        isOpen={m.isSearchOpen}
        onClose={m.closeSearch}
        initialQuery={m.searchSeedQuery}
        onSelectDocument={() => w.navigate('documents')}
        onSelectPaper={(p) => {
          w.openPaperInReader(p);
        }}
      />
      <AiOutlineModal
        isOpen={m.isOutlineOpen}
        onClose={m.closeOutline}
        initialTopic={
          activeDocument?.title &&
          !['Untitled Paper', 'Untitled Research Draft'].includes(activeDocument.title)
            ? activeDocument.title
            : ''
        }
        onInsertOutline={w.insertOutline}
      />
      <ZoteroImportModal isOpen={m.isZoteroOpen} onClose={m.closeZotero} />
      <ProviderQuotaModal isOpen={m.isProviderQuotaOpen} onClose={m.closeProviderQuota} />
      <TeamModal isOpen={m.isTeamOpen} onClose={m.closeTeam} />
      <VersionHistoryModal
        isOpen={m.isVersionHistoryOpen}
        documentId={activeDocument?.id || ''}
        currentTitle={activeDocument?.title || 'Untitled Paper'}
        onClose={m.closeVersionHistory}
        onVersionRestored={() => {
          if (activeDocument) {
            api.documents
              .get(activeDocument.id)
              .then((freshDoc) => {
                setActiveDocument(freshDoc);
              })
              .catch(() => {});
          }
        }}
      />
      <PluginManagerModal isOpen={m.isPluginsOpen} onClose={m.closePlugins} />
      <ExportModal
        isOpen={m.isExportOpen}
        onClose={m.closeExport}
        documentId={activeDocument?.id || ''}
        documentTitle={activeDocument?.title || 'Untitled Paper'}
        wordCount={stats.words}
        citationCount={documentCitations.length}
        initialCitationStyle={citationStyle}
      />
    </>
  );
};
