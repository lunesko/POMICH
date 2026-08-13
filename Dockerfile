FROM node:22-bookworm AS frontend-build

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . ./
RUN npm run build

FROM node:22-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    POMICH_RUNTIME=production

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip python3-venv \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN python3 -m pip install --break-system-packages --no-cache-dir -r requirements.txt \
    && python3 -c "import psycopg; import geoalchemy2"

COPY --from=frontend-build /app/dist ./dist
COPY . ./
COPY data/settlements.json ./data/settlements.json
COPY data/geo ./data/geo
RUN mkdir -p /app/data
RUN sed -i 's/\r$//' ./start.sh && chmod +x ./start.sh

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=3).read()"

CMD ["./start.sh"]
