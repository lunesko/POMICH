FROM node:22-bookworm@sha256:0e5f906573693feaa1e21057ebdcfdb5bd5021f050b2dc7c9deceb629c7da2a8 AS frontend-build

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . ./
ARG POMICH_BUILD_SHA=development
ENV POMICH_BUILD_SHA=$POMICH_BUILD_SHA
RUN npm run build

FROM python:3.11-slim-trixie@sha256:e88e9763f943ec1834f992a4b51e0f24500486803e8bc534e5767af9ea65f6ce

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    POMICH_RUNTIME=production

WORKDIR /app

COPY requirements.lock ./
RUN python3 -m pip install --require-hashes --no-cache-dir -r requirements.lock \
    && python3 -c "import psycopg; import geoalchemy2" \
    && python3 -m pip uninstall -y pip setuptools wheel

COPY --from=frontend-build /app/dist ./dist
COPY bot ./bot
COPY start.sh ./start.sh
COPY data/settlements.json ./data/settlements.json
COPY public/geo ./public/geo
RUN mkdir -p /app/data
RUN sed -i 's/\r$//' ./start.sh && chmod +x ./start.sh
RUN groupadd --gid 10001 pomich && useradd --uid 10001 --gid 10001 --no-create-home pomich \
    && chown -R pomich:pomich /app/data
USER 10001:10001

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/internal/ready', timeout=3).read()"

CMD ["./start.sh"]
