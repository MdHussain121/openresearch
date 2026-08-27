// OpenResearch Browser Extension Popup Logic
// Single-user local mode: the backend accepts unauthenticated requests.

document.addEventListener('DOMContentLoaded', async () => {
  const titleInput = document.getElementById('paperTitle');
  const identifierInput = document.getElementById('identifier');
  const apiUrlInput = document.getElementById('apiUrl');
  const projectSelect = document.getElementById('projectSelect');
  const saveBtn = document.getElementById('saveBtn');
  const statusMsg = document.getElementById('statusMsg');

  function getApiUrl() {
    return apiUrlInput.value.trim().replace(/\/$/, '');
  }

  async function loadProjects() {
    projectSelect.disabled = true;
    projectSelect.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Loading projects...';
    projectSelect.appendChild(placeholder);

    try {
      const projectsRes = await fetch(`${getApiUrl()}/projects`);
      if (projectsRes.status === 404) {
        throw new Error('Projects endpoint not found. Check the OpenResearch API URL.');
      }
      if (!projectsRes.ok) {
        throw new Error('Could not reach OpenResearch backend. Is the API server running?');
      }
      const projects = await projectsRes.json();
      if (!Array.isArray(projects) || projects.length === 0) {
        placeholder.textContent = 'No projects found';
        showStatus('No OpenResearch projects found. Please create a project in the app first.', 'error');
        return;
      }

      projectSelect.innerHTML = '';
      const selectPrompt = document.createElement('option');
      selectPrompt.value = '';
      selectPrompt.textContent = '— Select a project —';
      projectSelect.appendChild(selectPrompt);
      for (const project of projects) {
        const option = document.createElement('option');
        option.value = project.id;
        option.textContent = project.name;
        projectSelect.appendChild(option);
      }
    } catch (err) {
      placeholder.textContent = 'Unavailable';
      showStatus(err.message || 'Error communicating with OpenResearch', 'error');
    } finally {
      projectSelect.disabled = false;
    }
  }

  // Query current active tab
  if (typeof chrome !== 'undefined' && chrome.tabs) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        titleInput.value = tab.title || '';
        const url = tab.url || '';

        // Extract DOI or arXiv from URL
        const doiMatch = url.match(/10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/);
        const arxivMatch = url.match(/arxiv\.org\/(?:abs|pdf)\/(\d+\.\d+)/i);

        if (doiMatch) {
          identifierInput.value = doiMatch[0];
        } else if (arxivMatch) {
          identifierInput.value = arxivMatch[1];
        } else {
          identifierInput.value = url;
        }
      }
    } catch (e) {
      console.warn('Could not query tab:', e);
    }
  }

  await loadProjects();

  apiUrlInput.addEventListener('change', loadProjects);

  saveBtn.addEventListener('click', async () => {
    const title = titleInput.value.trim();
    const identifier = identifierInput.value.trim();
    const projectId = projectSelect.value;

    if (!identifier && !title) {
      showStatus('Please specify a title or DOI/URL', 'error');
      return;
    }
    if (!projectId) {
      showStatus('Please select a project before saving.', 'error');
      return;
    }
    const selectedOption = projectSelect.selectedOptions[0];
    const projectName = selectedOption ? selectedOption.textContent : projectId;

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving to OpenResearch...';

    try {
      const addRes = await fetch(`${getApiUrl()}/projects/${projectId}/papers/add-by-identifier`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: identifier || title,
          id_type: 'auto',
        }),
      });

      if (!addRes.ok) {
        const errJson = await addRes.json().catch(() => ({}));
        throw new Error(errJson.detail || 'Failed to add paper to OpenResearch');
      }

      const addedPaper = await addRes.json();
      showStatus(`Saved "${addedPaper.title || 'Paper'}" to project "${projectName}"!`, 'success');
      saveBtn.textContent = '✓ Saved to Library';
    } catch (err) {
      showStatus(err.message || 'Error communicating with OpenResearch', 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Retry Save';
    }
  });

  function showStatus(msg, type) {
    statusMsg.textContent = msg;
    statusMsg.className = `status ${type}`;
  }
});
