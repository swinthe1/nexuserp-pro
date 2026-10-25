# DrisPRO web app: built once, served as static files by nginx.
# The Supabase address and public (anon) key are baked into the build, so in Coolify
# set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY as *build* variables.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
RUN test -n "$VITE_SUPABASE_URL" && test -n "$VITE_SUPABASE_ANON_KEY" \
    || (echo "Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY as build variables" && exit 1)
RUN npx vite build
# the same version for servers of clients (local servers download it every night from /updates/)
RUN bash deploy/local/pack-update.sh dist

FROM nginx:1.27-alpine
COPY deploy/coolify/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/healthz || exit 1
