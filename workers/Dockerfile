# Workers (Celery worker + beat, CLI). Build vanuit de repo-root:  docker build -f workers/Dockerfile .
# Achter een TLS-inspecterende proxy: voeg  --secret id=ca_bundle,src=/pad/naar/ca.crt  toe.
ARG PYTHON_IMAGE=python:3.13-slim
FROM ${PYTHON_IMAGE} AS base
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY workers/docker/with-ca.sh /usr/local/bin/with-ca
# Pakketbronnen via https (integriteit + werkt achter proxy's die alleen HTTPS doorlaten)
RUN sed -i "s#http://deb.debian.org#https://deb.debian.org#g" /etc/apt/sources.list.d/debian.sources
RUN --mount=type=secret,id=ca_bundle,required=false with-ca pip install --no-cache-dir "uv>=0.9,<0.12"
WORKDIR /app/workers

# Eerst alleen de lockfile: dependency-laag blijft gecachet zolang uv.lock niet verandert
COPY workers/pyproject.toml workers/uv.lock ./
RUN --mount=type=secret,id=ca_bundle,required=false with-ca uv sync --frozen --no-dev --no-install-project

COPY workers/ ./
# Connector-manifests en migraties staan buiten workers/ en worden door de CLI gelezen
COPY db/ /app/db/
# libatomic1 is nodig voor de node-driver van Playwright; "uv run" vermijden (die synct de dev-groep er weer bij)
RUN --mount=type=secret,id=ca_bundle,required=false with-ca sh -c "apt-get update && apt-get install -y --no-install-recommends libatomic1 \
      && uv sync --frozen --no-dev && .venv/bin/playwright install --with-deps chromium" \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 --home /app trendscope \
 && chown -R trendscope /app /ms-playwright
USER trendscope
ENV PATH="/app/workers/.venv/bin:$PATH"

HEALTHCHECK --interval=60s --timeout=20s --start-period=60s CMD celery -A trendscope.worker.celery_app inspect ping -d "celery@$HOSTNAME" || exit 1
CMD ["celery", "-A", "trendscope.worker.celery_app", "worker", "--loglevel=INFO", "--concurrency=4"]
