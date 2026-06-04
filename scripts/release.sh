#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./scripts/release.sh <registry_repo> [version]

Examples:
  ./scripts/release.sh xxxxx/montex 1.0.0
  ./scripts/release.sh xxxxx/montex

Optional environment variables:
  PLATFORMS         Target platforms for podman build (default: linux/amd64,linux/arm64)
  BUILD_BASE        Build/push base image first: 1|0 (default: 1)
  BASE_REPO         Base image repo (default: <registry_repo>-base)
  BASE_TAG          Base image tag (default: <version>)
  BASE_DOCKERFILE   Base Dockerfile path (default: server-ce/Dockerfile-base)
  DOCKERFILE        Dockerfile path (default: server-ce/Dockerfile)
  CONTEXT           Build context (default: .)
  LOCAL_BASE_MANIFEST Local manifest name for base image build.
  LOCAL_APP_MANIFEST  Local manifest name for app image build.
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

if ! command -v podman >/dev/null 2>&1; then
  echo "Error: podman no está instalado o no está en PATH." >&2
  exit 1
fi

if ! podman manifest --help >/dev/null 2>&1; then
  echo "Error: podman manifest no está disponible." >&2
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
LOCAL_BASE_MANIFEST="${LOCAL_BASE_MANIFEST:-$(printf '%s' "${BASE_REPO}-${BASE_TAG}" | tr '/:@' '---')-manifest}"
LOCAL_APP_MANIFEST="${LOCAL_APP_MANIFEST:-$(printf '%s' "${REPO}-${VERSION}" | tr '/:@' '---')-manifest}"

if [[ "$BUILD_BASE" == "1" ]]; then
  OVERLEAF_BASE_TAG="${OVERLEAF_BASE_TAG:-${BASE_REPO}:${BASE_TAG}}"
else
  OVERLEAF_BASE_TAG="${OVERLEAF_BASE_TAG:-sharelatex/sharelatex-base:latest}"
fi

cleanup() {
  podman manifest rm --ignore "$LOCAL_BASE_MANIFEST" "$LOCAL_APP_MANIFEST" >/dev/null 2>&1 || true
}

infer_registry_host() {
  local repo="$1"
  local first_component="${repo%%/*}"
  if [[ "$repo" == "$first_component" ]]; then
    echo "docker.io"
  elif [[ "$first_component" == "localhost" || "$first_component" == *.* || "$first_component" == *:* ]]; then
    echo "$first_component"
  else
    echo "docker.io"
  fi
}

warn_if_podman_memory_is_low() {
  local mem_total_bytes
  mem_total_bytes="$(podman info --format '{{.Host.MemTotal}}' 2>/dev/null || echo 0)"

  if [[ "$mem_total_bytes" =~ ^[0-9]+$ ]] && (( mem_total_bytes > 0 && mem_total_bytes < 8589934592 )); then
    local mem_total_gib
    mem_total_gib=$(( mem_total_bytes / 1024 / 1024 / 1024 ))
    cat >&2 <<EOF
Advertencia: la VM de Podman tiene ${mem_total_gib} GiB de RAM.
Este release ejecuta npm install y webpack sobre un monorepo y suele necesitar al menos 8 GiB.
Con menos memoria es normal que falle con exit status 137.

Sugerencia:
  podman machine stop
  podman machine set --memory 8192
  podman machine start

Si solo necesitas publicar ARM64:
  PLATFORMS=linux/arm64 ./scripts/release.sh $REPO $VERSION
EOF
    echo >&2
  fi
}

build_and_push_manifest() {
  local manifest_name="$1"
  local dockerfile_path="$2"
  local version_ref="$3"
  local latest_ref="$4"
  shift 4
  local -a build_args=("$@")
  local -a build_cmd=(
    podman build
    --platform "$PLATFORMS"
    --manifest "$manifest_name"
    --file "$dockerfile_path"
  )

  podman manifest rm --ignore "$manifest_name" >/dev/null 2>&1 || true

  if [[ "${#build_args[@]}" -gt 0 ]]; then
    build_cmd+=("${build_args[@]}")
  fi
  build_cmd+=("$CONTEXT")

  "${build_cmd[@]}"

  podman manifest push --all "$manifest_name" "docker://${version_ref}"
  podman manifest push --all "$manifest_name" "docker://${latest_ref}"
}

trap cleanup EXIT

REGISTRY_HOST="$(infer_registry_host "$REPO")"
warn_if_podman_memory_is_low

echo "Repositorio registry   : $REPO"
echo "Versión               : $VERSION"
echo "Plataformas           : $PLATFORMS"
echo "Build base            : $BUILD_BASE"
echo "Base image            : $OVERLEAF_BASE_TAG"
echo "Dockerfile            : $DOCKERFILE"
echo "Contexto              : $CONTEXT"
echo
echo "Asegúrate de haber hecho login: podman login $REGISTRY_HOST"
echo

if [[ "$BUILD_BASE" == "1" ]]; then
  echo "Construyendo/push base: ${BASE_REPO}:${BASE_TAG}"
  build_and_push_manifest \
    "$LOCAL_BASE_MANIFEST" \
    "$BASE_DOCKERFILE" \
    "${BASE_REPO}:${BASE_TAG}" \
    "${BASE_REPO}:latest"
  echo
fi

build_and_push_manifest \
  "$LOCAL_APP_MANIFEST" \
  "$DOCKERFILE" \
  "$REPO:$VERSION" \
  "$REPO:latest" \
  --build-arg "OVERLEAF_BASE_TAG=$OVERLEAF_BASE_TAG"

echo
echo "Release publicada correctamente:"
echo "  - $REPO:$VERSION"
echo "  - $REPO:latest"
echo
echo "Despliegue recomendado:"
echo "  MONTEX_IMAGE=$REPO MONTEX_TAG=$VERSION podman compose -f docker-compose.release.yml up -d"
echo
echo "Comprobaciones:"
echo "  podman compose -f docker-compose.release.yml ps"
echo "  podman compose -f docker-compose.release.yml logs -f sharelatex"
