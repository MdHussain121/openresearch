export * from './client';
export * from './projects';
export * from './documents';
export * from './papers';
export * from './chat';
export * from './rag';
export * from './citations';
export * from './aiWriting';
export * from './autocompleteSettings';
export * from './export';
export * from './intelligence';
export * from './zotero';
export * from './system';
export * from './comments';
export * from './versions';
export * from './graphs';
export * from './plugins';
export * from './providers';
export * from './research';

import { projectsApi } from './projects';
import { documentsApi } from './documents';
import { papersApi } from './papers';
import { chatApi } from './chat';
import { ragApi } from './rag';
import { citationsApi } from './citations';
import { aiWritingApi } from './aiWriting';
import { autocompleteSettingsApi } from './autocompleteSettings';
import { exportApi } from './export';
import { intelligenceApi } from './intelligence';
import { zoteroApi } from './zotero';
import { systemApi } from './system';
import { commentsApi } from './comments';
import { versionsApi } from './versions';
import { graphsApi } from './graphs';
import { pluginsApi } from './plugins';
import { providersApi } from './providers';
import { researchApi } from './research';

export const api = {
  projects: projectsApi,
  documents: documentsApi,
  papers: papersApi,
  chat: chatApi,
  rag: ragApi,
  citations: citationsApi,
  ai: aiWritingApi,
  autocompleteSettings: autocompleteSettingsApi,
  export: exportApi,
  intelligence: intelligenceApi,
  zotero: zoteroApi,
  system: systemApi,
  comments: commentsApi,
  versions: versionsApi,
  graphs: graphsApi,
  plugins: pluginsApi,
  providers: providersApi,
  research: researchApi,
};
