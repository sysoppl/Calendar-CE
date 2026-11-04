# The base image by digest, so that a moved tag changes nothing unnoticed;
# bump both together (node:24-alpine, multi-platform index, 2026-10-26).
ARG NODE_IMAGE=node:24-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53

# --- build ---------------------------------------------------------------
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
# No dependency needs an install script (the lockfile has none outside
# macOS), so none gets to run code here.
RUN npm ci --no-audit --no-fund --ignore-scripts
# The public address of the app (the DAV proxy answers only for its host
# name) and the links the app shows (privacy policy, terms, contact; an empty
# one is not shown). Declared after the install so that
# changing them keeps its layer cached:
#   docker build --build-arg VITE_APP_URL=https://calendar.example.com .
ARG VITE_APP_URL=""
ARG VITE_PRIVACY_URL=""
ARG VITE_TERMS_URL=""
ARG VITE_CONTACT_URL=""
COPY . .
# Runs the prebuild step (third-party notices) as well.
RUN npm run build

# --- runtime -------------------------------------------------------------
# Zero-dependency Node server: serves dist/ and the /dav-proxy endpoint.
FROM ${NODE_IMAGE}
WORKDIR /app
# The host names the DAV proxy answers for come from the app's address, so
# the build argument is carried over (the environment can still override it).
ARG VITE_APP_URL=""
ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0 VITE_APP_URL=${VITE_APP_URL}
COPY --from=build /app/dist ./dist
# Only the modules the server runs: no tests, no type declarations.
COPY server/*.mjs ./server/
COPY package.json ./
USER node
EXPOSE 8787
# Shell form, so the port is the one the container was started with.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD wget -qO /dev/null "http://127.0.0.1:${PORT:-8787}/" || exit 1
CMD ["node", "server/server.mjs"]
