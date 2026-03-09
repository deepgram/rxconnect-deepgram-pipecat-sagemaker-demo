# Single stage: pre-built Next.js + Python backend + nginx
FROM python:3.12-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends nginx nodejs npm netcat-openbsd && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python backend
COPY server/requirements.txt /app/server/requirements.txt
RUN pip install --no-cache-dir -r /app/server/requirements.txt

COPY server/ /app/server/
COPY data/ /app/data/

# Next.js frontend (pre-built locally — run `npm run build` in client/ before deploying)
COPY client/.next /app/client/.next
COPY client/node_modules /app/client/node_modules
COPY client/package.json /app/client/package.json
COPY client/public /app/client/public
COPY client/next.config.js /app/client/next.config.js

# Nginx config
COPY fly/nginx.conf /etc/nginx/nginx.conf

# Entrypoint
COPY fly/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 8080

CMD ["/app/entrypoint.sh"]
