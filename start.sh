#!/bin/sh
echo "=== Building frontend ==="
npx vite build
echo "=== Starting server ==="
npx tsx server.ts
