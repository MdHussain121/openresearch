# Tabby — Local AI Autocomplete

[Tabby](https://github.com/TabbyML/tabby) is a keyless, self-hosted code/text completion server.
OpenResearch uses it **only for inline autocomplete** (ghost text & paragraph continuation).
Chat, AI editing, and outline generation keep using your configured cloud providers or Ollama,
so RAG grounding is unaffected either way.

## Quick start

### Option A: one-click from the app

Open **Settings → AI Autocomplete → Set Up Tabby**. This will:

1. Install the Tabby CLI if missing (`winget install TabbyML.Tabby` on Windows,
   `brew install tabbyml/tabby/tabby` on macOS/Linux).
2. Start `tabby serve --model <model> --device cpu --no-webserver` in the
   background (logs: `storage/tabby-server.log`).
3. Detect port conflicts (e.g. Steam squatting on 8080), poll the health
   endpoint, and report status honestly — including a log tail on failure.

The first start downloads the model weights (~1.5 GB for Qwen2.5-Coder-1.5B),
so it can stay "not answering" for several minutes — click **Test Connection**
again afterwards.

### Option B: manual

```bash
# Windows (winget)
winget install --id TabbyML.Tabby -e

# macOS / Linux (Homebrew)
brew install tabbyml/tabby/tabby

# Serve (pick a free port!)
tabby serve --model Qwen2.5-Coder-1.5B --device cpu --port 9090 --no-webserver
```

Then set **Settings → AI Autocomplete → Base URL** to `http://127.0.0.1:<port>` and save.

> **Port warning:** do not use `8080` blindly. Desktop apps commonly squat on it
> (Steam's debug server binds 127.0.0.1:8080 on many machines). The setup flow detects
> this and tells you to pick another port.
>
> **`--no-webserver` is required.** Without it, Tabby's web layer returns
> **401 Unauthorized** on `/v1/*` until an admin account is registered through its
> own UI — which a headless integration never does.

## Configuration

Environment variables (see `.env.example`) provide defaults; user-saved settings in
the UI override them per machine:

| Variable | Default | Purpose |
| --- | --- | --- |
| `TABBY_BASE_URL` | `http://localhost:8080` | Tabby server endpoint |
| `TABBY_MODEL` | `Qwen2.5-Coder-1.5B` | Model served by Tabby |
| `TABBY_AUTOCOMPLETE_ENABLED` | `false` | Master toggle for the integration (opt-in) |

The integration is **off by default**. Toggling it on in Settings also starts the
local Tabby server automatically (when the CLI is installed and the port is free).

Settings are stored locally in `storage/provider_keys.json` under `autocomplete`
(`enabled`, `engine`, `base_url`, `model`). Engine values:

- `auto` *(default)* — use Tabby when healthy, else cloud → Ollama chain
- `tabby` — prefer Tabby, fall back to the chain if it fails mid-request
- `cloud` / `ollama` — skip Tabby entirely

## API surface

| Endpoint | Purpose |
| --- | --- |
| `GET /api/v1/ai/autocomplete-settings` | Effective settings |
| `PUT /api/v1/ai/autocomplete-settings` | Update settings (400 on bad engine) |
| `POST /api/v1/ai/autocomplete-settings/probe` | Live `/v1/health` check (cache-bypassing) |
| `GET /api/v1/ai/autocomplete-settings/status` | Is the CLI installed? Which version? |
| `POST /api/v1/ai/autocomplete-settings/setup` | Install + start + verify (never raises) |

## How completions work

Requests go through the normal autocomplete pipeline (`ai_writing_service`), so grounding
passages from your library are still retrieved and returned. When Tabby is selected as the
engine, the backend calls Tabby's native `POST /v1/completions` with a segments body
(`{"segments": {"prefix": ..., "suffix": ...}}`) — Tabby builds the fill-in-the-middle
prompt server-side, so no FIM tokens or stop sequences are needed client-side. Short
timeouts (3–6 s) keep ghost text snappy. Any Tabby failure falls back to the standard
chain — never fabricated content.
