FROM denoland/deno:2.1.10

WORKDIR /app

# Copy dependency manifests first for layer caching
COPY deno.json .
COPY fresh.gen.ts .

# Copy all source
COPY . .

# Cache all remote imports (network access only during build)
RUN deno cache main.ts

# Build the Fresh production bundle → creates _fresh/ with JS chunks
RUN deno task build

EXPOSE 8000

# DENO_DEPLOYMENT_ID switches Fresh into production mode so it serves the
# pre-built _fresh/ bundle instead of compiling on every request.
# Static files in static/ (including styles.css) are always served as-is.
ENV DENO_DEPLOYMENT_ID=cmeme-production
ENV PORT=8000

CMD ["deno", "run", "-A", "main.ts"]
