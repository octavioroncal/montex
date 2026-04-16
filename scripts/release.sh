#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./scripts/release.sh <dockerhub_repo> [version]

Examples:
  ./scripts/release.sh xxxxx/montex 1.0.0
  ./scripts/release.sh xxxxx/montex

Optional environment variables:
  PLATFORMS         Target platforms for buildx (default: linux/amd64,linux/arm64)
  BUILD_BASE        Build/push base image first: 1|0 (default: 1)
  BASE_REPO         Base image repo (default: <dockerhub_repo>-base)
  BASE_TAG          Base image tag (default: <version>)
  BASE_DOCKERFILE   Base Dockerfile path (default: server-ce/Dockerfile-base)
  DOCKERFILE        Dockerfile path (default: server-ce/Dockerfile)
  CONTEXT           Build context (default: .)
  OVERLEAF_BASE_TAG Base image for app build.
                    If BUILD_BASE=1 it is auto-set to BASE_REPO:BASE_TAG.
                    If BUILD_BASE=0 default is sharelatex/sharelatex-base:latest.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

REPO="${1:-}"
if [[ -z "$REPO" ]]; then
  usage
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: docker no está instalado o no está en PATH." >&2
  exit 1
fi

if ! docker buildx version >/dev/null 2>&1; then
  echo "Error: docker buildx no está disponible." >&2
  exit 1
fi

VERSION="${2:-}"
if [[ -z "$VERSION" ]]; then
  VERSION="$(date +%Y.%m.%d)-$(git rev-parse --short HEAD)"
fi

PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"
BUILD_BASE="${BUILD_BASE:-1}"
BASE_REPO="${BASE_REPO:-${REPO}-base}"
BASE_TAG="${BASE_TAG:-$VERSION}"
BASE_DOCKERFILE="${BASE_DOCKERFILE:-server-ce/Dockerfile-base}"
DOCKERFILE="${DOCKERFILE:-server-ce/Dockerfile}"
CONTEXT="${CONTEXT:-.}"

if [[ "$BUILD_BASE" == "1" ]]; then
  OVERLEAF_BASE_TAG="${OVERLEAF_BASE_TAG:-${BASE_REPO}:${BASE_TAG}}"
else
  OVERLEAF_BASE_TAG="${OVERLEAF_BASE_TAG:-sharelatex/sharelatex-base:latest}"
fi

echo "Repositorio Docker Hub : $REPO"
echo "Versión               : $VERSION"
echo "Plataformas           : $PLATFORMS"
echo "Build base            : $BUILD_BASE"
echo "Base image            : $OVERLEAF_BASE_TAG"
echo "Dockerfile            : $DOCKERFILE"
echo "Contexto              : $CONTEXT"
echo
echo "Asegúrate de haber hecho login: docker login"
echo

if [[ "$BUILD_BASE" == "1" ]]; then
  echo "Construyendo/push base: ${BASE_REPO}:${BASE_TAG}"
  docker buildx build \
    --platform "$PLATFORMS" \
    --file "$BASE_DOCKERFILE" \
    --tag "${BASE_REPO}:${BASE_TAG}" \
    --tag "${BASE_REPO}:latest" \
    --push \
    "$CONTEXT"
  echo
fi

docker buildx build \
  --platform "$PLATFORMS" \
  --file "$DOCKERFILE" \
  --build-arg "OVERLEAF_BASE_TAG=$OVERLEAF_BASE_TAG" \
  --tag "$REPO:$VERSION" \
  --tag "$REPO:latest" \
  --push \
  "$CONTEXT"

echo
echo "Release publicada correctamente:"
echo "  - $REPO:$VERSION"
echo "  - $REPO:latest"
echo
echo "Despliegue recomendado:"
echo "  MONTEX_IMAGE=$REPO MONTEX_TAG=$VERSION docker compose -f docker-compose.release.yml up -d"
echo
echo "Comprobaciones:"
echo "  docker compose -f docker-compose.release.yml ps"
echo "  docker compose -f docker-compose.release.yml logs -f sharelatex"
