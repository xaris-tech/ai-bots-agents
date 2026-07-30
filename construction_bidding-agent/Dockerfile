# Render deploy target for the FastAPI backend + Node scraping pipeline.
# Separate from ./Dockerfile (the ADK-scaffolded Cloud Run image, Python-only)
# because this one also needs Node + Playwright's Chromium to run the scrapers.
#
# NOT covered here: scripts/scrape-cloudflare-sites.mjs and
# scripts/scrape-via-real-chrome.mjs. Both drive a real Google Chrome install
# over CDP to pass Cloudflare's managed challenge — that only works against a
# real desktop Chrome, not inside a container. Run those locally and let them
# feed the same database if you need the 7 Cloudflare-walled sites.

FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv==0.8.13

WORKDIR /code

# --- Python deps ---
COPY ./pyproject.toml ./README.md ./uv.lock* ./
COPY ./app ./app
RUN uv sync --frozen

# --- Node deps + Playwright browser ---
COPY ./package.json ./package-lock.json ./
RUN npm ci
RUN npx playwright install --with-deps chromium

# --- Scraper pipeline code the FastAPI backend shells out to ---
COPY ./scripts ./scripts
COPY ./src ./src
COPY ./config ./config

# --- Seed database (free-plan deploy has no persistent disk / can't scrape).
# Bakes a snapshot of scraped bids into the image so the dashboard shows data
# on every fresh container. Read-mostly: session writes (approvals, scans)
# reset on restart. Contains only public tender data, no credentials. Lands at
# /code/data/bid-copilot.db, the default BID_DATABASE_PATH. ---
COPY ./data/bid-copilot.db ./data/bid-copilot.db

ARG COMMIT_SHA=""
ENV COMMIT_SHA=${COMMIT_SHA}

EXPOSE 8080

CMD ["uv", "run", "uvicorn", "app.fast_api_app:app", "--host", "0.0.0.0", "--port", "8080"]
