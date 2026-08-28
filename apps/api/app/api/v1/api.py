from fastapi import APIRouter

from app.api.v1.endpoints import (
    ai_writing,
    auth,
    chat,
    citations,
    collaboration,
    comments,
    documents,
    export,
    graphs,
    health,
    intelligence,
    papers,
    plugins,
    projects,
    provider_settings,
    provider_status,
    research,
    version_history,
    zotero,
)

api_router = APIRouter()
api_router.include_router(health.router, tags=["Health"])
api_router.include_router(auth.router, tags=["Auth"])
api_router.include_router(projects.router, tags=["Projects"])
api_router.include_router(documents.router, tags=["Documents"])
api_router.include_router(papers.router, tags=["Papers"])
api_router.include_router(chat.router, tags=["Chat"])
api_router.include_router(citations.router, tags=["Citations"])
api_router.include_router(ai_writing.router, tags=["AI Writing"])
api_router.include_router(export.router, tags=["Export"])
api_router.include_router(intelligence.router, tags=["Research Intelligence"])
api_router.include_router(zotero.router, tags=["Zotero Sync"])
api_router.include_router(provider_status.router, tags=["Provider Status"])
api_router.include_router(research.router, tags=["Literature Search"])
api_router.include_router(provider_settings.router, tags=["AI Provider Settings"])
api_router.include_router(collaboration.router, tags=["Real-Time Collaboration"])
api_router.include_router(comments.router, tags=["Comments"])
api_router.include_router(version_history.router, tags=["Version History"])
api_router.include_router(graphs.router, tags=["Research Graphs"])
api_router.include_router(plugins.router, tags=["Plugin System"])
