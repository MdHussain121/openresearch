import { resolveApiUrl, extractErrorMessage } from './client';

export const exportApi = {
  download: async (
    documentId: string,
    options: {
      export_format: string;
      citation_style?: string;
      include_bibliography?: boolean;
      include_trust_markers?: boolean;
    }
  ): Promise<{ filename: string; blob: Blob }> => {
    const url = resolveApiUrl();
    const res = await fetch(`${url}/documents/${documentId}/export`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(options),
    });

    if (!res.ok) {
      throw new Error(await extractErrorMessage(res, 'Export request failed'));
    }

    const disposition = res.headers.get('Content-Disposition') || '';
    let filename = `document.${options.export_format === 'markdown' ? 'md' : options.export_format}`;
    const match = disposition.match(/filename="?([^"]+)"?/);
    if (match && match[1]) {
      filename = match[1];
    }

    const blob = await res.blob();
    return { filename, blob };
  },
  getUrl: (documentId: string, format: string, style: string = 'apa'): string => {
    const url = resolveApiUrl();
    return `${url}/documents/${documentId}/export/${format}?style=${style}`;
  },
};
