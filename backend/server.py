"""
AutoLenis — API Proxy
Forwards all /api/* requests from port 8001 (Emergent ingress requirement)
to Next.js on port 3000 which handles both frontend and API routes.

Architecture note: In Vercel production, Next.js handles all routes including
/api/* natively. This proxy exists only for the Emergent preview environment
which routes /api/* to port 8001 via ingress.
"""

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.background import BackgroundTask
import httpx
import os
import logging

NEXTJS_BASE_URL = "http://localhost:3000"

app = FastAPI(title="AutoLenis API Proxy", docs_url=None, redoc_url=None)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@app.api_route(
    "/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
)
async def proxy(path: str, request: Request) -> Response:
    """Forward all requests to Next.js on port 3000."""
    url = f"{NEXTJS_BASE_URL}/{path}"

    # Preserve query parameters
    if request.query_params:
        url = f"{url}?{request.query_params}"

    # Build forward headers (strip hop-by-hop headers)
    hop_by_hop = {
        "connection", "keep-alive", "proxy-authenticate",
        "proxy-authorization", "te", "trailers",
        "transfer-encoding", "upgrade", "host",
    }
    forward_headers = {
        k: v
        for k, v in request.headers.items()
        if k.lower() not in hop_by_hop
    }
    forward_headers["host"] = "localhost:3000"

    body = await request.body()

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.request(
                method=request.method,
                url=url,
                headers=forward_headers,
                content=body,
            )

        # Strip hop-by-hop from response headers
        response_headers = {
            k: v
            for k, v in resp.headers.items()
            if k.lower() not in hop_by_hop
        }

        return Response(
            content=resp.content,
            status_code=resp.status_code,
            headers=response_headers,
            media_type=resp.headers.get("content-type"),
        )

    except httpx.ConnectError:
        logger.warning("Next.js not yet ready — returning 503")
        return Response(
            content=b'{"error":{"code":"SERVICE_UNAVAILABLE","message":"Application starting up - please retry"},"correlationId":"proxy"}',
            status_code=503,
            media_type="application/json",
        )
    except Exception as exc:
        logger.error(f"Proxy error: {exc}")
        return Response(
            content=b'{"error":{"code":"PROXY_ERROR","message":"Internal proxy error"},"correlationId":"proxy"}',
            status_code=502,
            media_type="application/json",
        )
