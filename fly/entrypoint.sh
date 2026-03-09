#!/bin/sh
set -e

echo "Starting RxConnect Voice Agent..."

cleanup() {
    echo "Shutting down..."
    kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null
    exit 0
}
trap cleanup TERM INT

# Start FastAPI backend
cd /app/server
python main.py &
BACKEND_PID=$!

# Start Next.js frontend
cd /app/client
NODE_ENV=production npx next start -p 3000 &
FRONTEND_PID=$!

# Wait for both services to be ready
echo "Waiting for backend (port 8000)..."
for i in $(seq 1 30); do
    if nc -z 127.0.0.1 8000 2>/dev/null; then break; fi
    sleep 1
done

echo "Waiting for frontend (port 3000)..."
for i in $(seq 1 30); do
    if nc -z 127.0.0.1 3000 2>/dev/null; then break; fi
    sleep 1
done

echo "All services started. Starting nginx on port 8080..."

# Run nginx in the foreground — this keeps the container alive
exec nginx -g "daemon off;"
