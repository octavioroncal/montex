#!/usr/bin/env bash
set -uo pipefail

usage() {
  cat <<'EOF'
Uso:
  check-montex-api.sh --base-url URL --email EMAIL --password PASS [opciones]

Opciones:
  --base-url URL     Base URL de Montex (ej: https://editor.cardio.dev.local.monentia.es)
  --email EMAIL      Credencial para prueba con campo "email"
  --username USER    Credencial para prueba con campo "username" (por defecto: email)
  --password PASS    Contraseña
  --proxy URL        Proxy (ej: socks5h://192.168.42.61:1080)
  --insecure         Añade -k a curl (solo diagnóstico)
  --out-dir DIR      Carpeta de salida (por defecto: /tmp/montex-check-YYYYmmdd-HHMMSS)
  -h, --help         Mostrar esta ayuda

También puedes usar variables de entorno:
  BASE_URL, MONTEX_EMAIL, MONTEX_USERNAME, MONTEX_PASSWORD, MONTEX_PROXY, MONTEX_INSECURE, OUT_DIR
EOF
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: falta el comando requerido: $cmd" >&2
    exit 1
  fi
}

BASE_URL="${BASE_URL:-}"
EMAIL="${MONTEX_EMAIL:-}"
USERNAME="${MONTEX_USERNAME:-}"
PASSWORD="${MONTEX_PASSWORD:-}"
PROXY_URL="${MONTEX_PROXY:-}"
INSECURE="${MONTEX_INSECURE:-false}"
OUT_DIR="${OUT_DIR:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url)
      BASE_URL="${2:-}"
      shift 2
      ;;
    --email)
      EMAIL="${2:-}"
      shift 2
      ;;
    --username)
      USERNAME="${2:-}"
      shift 2
      ;;
    --password)
      PASSWORD="${2:-}"
      shift 2
      ;;
    --proxy)
      PROXY_URL="${2:-}"
      shift 2
      ;;
    --insecure)
      INSECURE="true"
      shift
      ;;
    --out-dir)
      OUT_DIR="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: opción no reconocida: $1" >&2
      usage
      exit 1
      ;;
  esac
done

require_cmd curl
require_cmd jq

if [[ -z "$BASE_URL" || -z "$EMAIL" || -z "$PASSWORD" ]]; then
  echo "ERROR: base-url, email y password son obligatorios." >&2
  usage
  exit 1
fi

if [[ -z "$USERNAME" ]]; then
  USERNAME="$EMAIL"
fi

BASE_URL="${BASE_URL%/}"
if [[ -z "$OUT_DIR" ]]; then
  OUT_DIR="/tmp/montex-check-$(date +%Y%m%d-%H%M%S)"
fi
mkdir -p "$OUT_DIR"

curl_base=(--silent --show-error --location)
if [[ -n "$PROXY_URL" ]]; then
  curl_base+=(--proxy "$PROXY_URL")
fi
insecure_normalized="$(printf '%s' "$INSECURE" | tr '[:upper:]' '[:lower:]')"
if [[ "$insecure_normalized" == "true" || "$insecure_normalized" == "1" || "$insecure_normalized" == "yes" ]]; then
  curl_base+=(-k)
fi

run_request() {
  local method="$1"
  local url="$2"
  local headers_file="$3"
  local body_file="$4"
  shift 4

  local http_code
  http_code="$(curl "${curl_base[@]}" -X "$method" "$@" -D "$headers_file" -o "$body_file" -w "%{http_code}" "$url" || true)"
  printf "%s" "$http_code"
}

echo "== Montex API check =="
echo "Base URL : $BASE_URL"
echo "Out dir  : $OUT_DIR"
echo

token_probe_status="$(run_request \
  "GET" \
  "$BASE_URL/api/v1/token" \
  "$OUT_DIR/00_probe_token_headers.txt" \
  "$OUT_DIR/00_probe_token_body.txt" \
  -H "Accept: application/json")"
echo "[1/5] Probe /api/v1/token -> HTTP $token_probe_status"

payload_email="$(jq -nc --arg email "$EMAIL" --arg password "$PASSWORD" '{email:$email,password:$password}')"
token_email_status="$(run_request \
  "POST" \
  "$BASE_URL/api/v1/token" \
  "$OUT_DIR/01_token_email_headers.txt" \
  "$OUT_DIR/01_token_email_body.json" \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  --data "$payload_email")"
echo "[2/5] Token by email -> HTTP $token_email_status"

payload_username="$(jq -nc --arg username "$USERNAME" --arg password "$PASSWORD" '{username:$username,password:$password}')"
token_username_status="$(run_request \
  "POST" \
  "$BASE_URL/api/v1/token" \
  "$OUT_DIR/02_token_username_headers.txt" \
  "$OUT_DIR/02_token_username_body.json" \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  --data "$payload_username")"
echo "[3/5] Token by username -> HTTP $token_username_status"

token_email="$(jq -r '.access_token // empty' "$OUT_DIR/01_token_email_body.json" 2>/dev/null || true)"
token_username="$(jq -r '.access_token // empty' "$OUT_DIR/02_token_username_body.json" 2>/dev/null || true)"

token=""
token_source=""
if [[ -n "$token_email" ]]; then
  token="$token_email"
  token_source="email"
elif [[ -n "$token_username" ]]; then
  token="$token_username"
  token_source="username"
fi

if [[ -z "$token" ]]; then
  echo
  echo "ERROR: no se obtuvo access_token con email ni username."
  echo "Revisa:"
  echo "  - $OUT_DIR/01_token_email_body.json"
  echo "  - $OUT_DIR/02_token_username_body.json"
  exit 1
fi

echo "Token source : $token_source"
echo "Token length : ${#token}"

projects_status="$(run_request \
  "GET" \
  "$BASE_URL/api/v1/user/projects/summary" \
  "$OUT_DIR/03_projects_headers.txt" \
  "$OUT_DIR/03_projects_body.json" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $token")"
echo "[4/5] /api/v1/user/projects/summary -> HTTP $projects_status"

project_id="$(jq -r '.projects[0].project_id // empty' "$OUT_DIR/03_projects_body.json" 2>/dev/null || true)"
if [[ -n "$project_id" ]]; then
  structure_status="$(run_request \
    "GET" \
    "$BASE_URL/api/v1/project/$project_id/structure" \
    "$OUT_DIR/04_structure_headers.txt" \
    "$OUT_DIR/04_structure_body.json" \
    -H "Accept: application/json" \
    -H "Authorization: Bearer $token")"
  echo "[5/5] /api/v1/project/$project_id/structure -> HTTP $structure_status"
else
  echo "[5/5] Saltado: no hay project_id en la respuesta de proyectos."
fi

echo
echo "Archivos de diagnóstico:"
echo "  $OUT_DIR/00_probe_token_headers.txt"
echo "  $OUT_DIR/01_token_email_headers.txt"
echo "  $OUT_DIR/01_token_email_body.json"
echo "  $OUT_DIR/02_token_username_headers.txt"
echo "  $OUT_DIR/02_token_username_body.json"
echo "  $OUT_DIR/03_projects_headers.txt"
echo "  $OUT_DIR/03_projects_body.json"
if [[ -n "${project_id:-}" ]]; then
  echo "  $OUT_DIR/04_structure_headers.txt"
  echo "  $OUT_DIR/04_structure_body.json"
fi
