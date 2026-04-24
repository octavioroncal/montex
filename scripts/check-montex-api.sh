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
  --project-id ID    Project ID a comprobar (si no se indica, usa el primero del usuario)
  --check-path PATH  Ruta de prueba para PUT/GET por subruta (por defecto: .montex-api-check/healthcheck.txt)
  --with-compiled-pdf
                     También prueba /download/compiled-pdf/by-path (más lento)
  --proxy URL        Proxy (ej: socks5h://192.168.42.61:1080)
  --insecure         Añade -k a curl (solo diagnóstico)
  --out-dir DIR      Carpeta de salida (por defecto: /tmp/montex-check-YYYYmmdd-HHMMSS)
  -h, --help         Mostrar esta ayuda

También puedes usar variables de entorno:
  BASE_URL, MONTEX_EMAIL, MONTEX_USERNAME, MONTEX_PASSWORD,
  MONTEX_PROJECT_ID, MONTEX_CHECK_PATH, MONTEX_WITH_COMPILED_PDF,
  MONTEX_PROXY, MONTEX_INSECURE, OUT_DIR
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
PROJECT_ID="${MONTEX_PROJECT_ID:-}"
CHECK_PATH="${MONTEX_CHECK_PATH:-.montex-api-check/healthcheck.txt}"
WITH_COMPILED_PDF="${MONTEX_WITH_COMPILED_PDF:-false}"
PROXY_URL="${MONTEX_PROXY:-}"
INSECURE="${MONTEX_INSECURE:-false}"
OUT_DIR="${OUT_DIR:-}"

lowercase() {
  printf "%s" "${1:-}" | tr '[:upper:]' '[:lower:]'
}

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
    --project-id)
      PROJECT_ID="${2:-}"
      shift 2
      ;;
    --check-path)
      CHECK_PATH="${2:-}"
      shift 2
      ;;
    --with-compiled-pdf)
      WITH_COMPILED_PDF="true"
      shift
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
insecure_lc="$(lowercase "$INSECURE")"
if [[ "$insecure_lc" == "true" || "$insecure_lc" == "1" || "$insecure_lc" == "yes" ]]; then
  curl_base+=(-k)
fi

is_true() {
  local value
  value="$(lowercase "${1:-}")"
  case "$value" in
    true|1|yes|y|on)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

is_2xx() {
  local code="${1:-}"
  [[ "$code" =~ ^2[0-9][0-9]$ ]]
}

urlencode() {
  local raw="$1"
  jq -nr --arg v "$raw" '$v|@uri'
}

get_header_value() {
  local headers_file="$1"
  local header_name="$2"
  awk -v key="$header_name" '
    BEGIN { IGNORECASE=1 }
    $0 ~ ("^" key ":") {
      line=$0
      sub(/\r$/, "", line)
      sub("^[^:]+:[[:space:]]*", "", line)
      value=line
    }
    END { print value }
  ' "$headers_file"
}

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

step=0
log_step() {
  step=$((step + 1))
  echo "[$step] $1"
}

echo "== Montex API check =="
echo "Base URL : $BASE_URL"
echo "Out dir  : $OUT_DIR"
if [[ -n "$PROJECT_ID" ]]; then
  echo "Project  : $PROJECT_ID"
else
  echo "Project  : (auto)"
fi
echo "Check path: $CHECK_PATH"
echo "Compiled PDF check: $WITH_COMPILED_PDF"
echo

token_probe_status="$(run_request \
  "GET" \
  "$BASE_URL/api/v1/token" \
  "$OUT_DIR/00_probe_token_headers.txt" \
  "$OUT_DIR/00_probe_token_body.txt" \
  -H "Accept: application/json")"
log_step "Probe /api/v1/token -> HTTP $token_probe_status"
if [[ "$token_probe_status" == "404" || "$token_probe_status" == "405" ]]; then
  echo "    nota: esperado en algunos despliegues (token solo admite POST)."
fi

payload_email="$(jq -nc --arg email "$EMAIL" --arg password "$PASSWORD" '{email:$email,password:$password}')"
token_email_status="$(run_request \
  "POST" \
  "$BASE_URL/api/v1/token" \
  "$OUT_DIR/01_token_email_headers.txt" \
  "$OUT_DIR/01_token_email_body.json" \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  --data "$payload_email")"
log_step "Token by email -> HTTP $token_email_status"

payload_username="$(jq -nc --arg username "$USERNAME" --arg password "$PASSWORD" '{username:$username,password:$password}')"
token_username_status="$(run_request \
  "POST" \
  "$BASE_URL/api/v1/token" \
  "$OUT_DIR/02_token_username_headers.txt" \
  "$OUT_DIR/02_token_username_body.json" \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  --data "$payload_username")"
log_step "Token by username -> HTTP $token_username_status"

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
log_step "/api/v1/user/projects/summary -> HTTP $projects_status"

if [[ -z "$PROJECT_ID" ]]; then
  PROJECT_ID="$(jq -r '.projects[0].project_id // empty' "$OUT_DIR/03_projects_body.json" 2>/dev/null || true)"
fi

if [[ -n "$PROJECT_ID" ]]; then
  structure_status="$(run_request \
    "GET" \
    "$BASE_URL/api/v1/project/$PROJECT_ID/structure" \
    "$OUT_DIR/04_structure_headers.txt" \
    "$OUT_DIR/04_structure_body.json" \
    -H "Accept: application/json" \
    -H "Authorization: Bearer $token")"
  log_step "/api/v1/project/$PROJECT_ID/structure -> HTTP $structure_status"

  sample_entity_path=""
  sample_tex_path=""
  if is_2xx "$structure_status"; then
    sample_entity_path="$(jq -r '
      def node_paths:
        (.docs[]?.path),
        (.files[]?.path),
        (.folders[]? | node_paths);
      [.structure | node_paths]
      | map(select(type == "string" and length > 0))
      | .[0] // empty
    ' "$OUT_DIR/04_structure_body.json" 2>/dev/null || true)"
    sample_tex_path="$(jq -r '
      def doc_paths:
        (.docs[]?.path),
        (.folders[]? | doc_paths);
      [.structure | doc_paths]
      | map(select(type == "string" and length > 0))
      | map(select(test("\\.tex$")))
      | .[0] // empty
    ' "$OUT_DIR/04_structure_body.json" 2>/dev/null || true)"
  fi

  upsert_payload_file="$OUT_DIR/05_upsert_payload.txt"
  upsert_content="Montex API check $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf "%s" "$upsert_content" > "$upsert_payload_file"

  encoded_check_path="$(urlencode "$CHECK_PATH")"
  upsert_status="$(run_request \
    "PUT" \
    "$BASE_URL/api/v1/project/$PROJECT_ID/file/by-path/$encoded_check_path" \
    "$OUT_DIR/05_upsert_headers.txt" \
    "$OUT_DIR/05_upsert_body.json" \
    -H "Accept: application/json" \
    -H "Authorization: Bearer $token" \
    -H "Content-Type: text/plain" \
    --data-binary "@$upsert_payload_file")"
  log_step "/api/v1/project/$PROJECT_ID/file/by-path/$CHECK_PATH -> HTTP $upsert_status"
  if [[ "$upsert_status" == "403" ]]; then
    upsert_content_type="$(get_header_value "$OUT_DIR/05_upsert_headers.txt" "content-type")"
    if [[ "$upsert_content_type" == text/html* ]] && grep -qi 'csrf' "$OUT_DIR/05_upsert_body.json"; then
      echo "    nota: 403 por CSRF (probable ruta /api/v1/.../file/by-path no desplegada en esta instancia)."
    else
      echo "    nota: token sin permisos de escritura en este proyecto."
    fi
  fi

  download_path=""
  compare_with_payload="false"
  if [[ "$upsert_status" == "200" || "$upsert_status" == "201" ]]; then
    download_path="$CHECK_PATH"
    compare_with_payload="true"
  elif [[ -n "$sample_entity_path" ]]; then
    download_path="$sample_entity_path"
  fi

  if [[ -n "$download_path" ]]; then
    encoded_download_path="$(urlencode "$download_path")"
    download_status="$(run_request \
      "GET" \
      "$BASE_URL/api/v1/project/$PROJECT_ID/download/by-path/$encoded_download_path" \
      "$OUT_DIR/06_download_by_path_headers.txt" \
      "$OUT_DIR/06_download_by_path_body.bin" \
      -H "Accept: */*" \
      -H "Authorization: Bearer $token")"
    log_step "/api/v1/project/$PROJECT_ID/download/by-path/$download_path -> HTTP $download_status"

    if is_2xx "$download_status" && [[ "$compare_with_payload" == "true" ]]; then
      if cmp -s "$upsert_payload_file" "$OUT_DIR/06_download_by_path_body.bin"; then
        echo "    roundtrip PUT/GET: OK"
      else
        echo "    roundtrip PUT/GET: ERROR (contenido distinto)"
      fi
    fi
  else
    log_step "Saltado download/by-path: no hubo path usable (ni por PUT ni en estructura)"
  fi

  delete_status="$(run_request \
    "DELETE" \
    "$BASE_URL/api/v1/project/$PROJECT_ID/entity/by-path/$encoded_check_path" \
    "$OUT_DIR/08_delete_by_path_headers.txt" \
    "$OUT_DIR/08_delete_by_path_body.txt" \
    -H "Accept: application/json" \
    -H "Authorization: Bearer $token")"
  log_step "/api/v1/project/$PROJECT_ID/entity/by-path/$CHECK_PATH -> HTTP $delete_status"

  delete_content_type="$(get_header_value "$OUT_DIR/08_delete_by_path_headers.txt" "content-type")"
  if [[ "$delete_status" == "403" ]]; then
    if [[ "$delete_content_type" == text/html* ]] && grep -qi 'csrf' "$OUT_DIR/08_delete_by_path_body.txt"; then
      echo "    nota: 403 por CSRF (probable ruta /api/v1/.../entity/by-path no desplegada en esta instancia)."
    else
      echo "    nota: token sin permisos de escritura para borrar en este proyecto."
    fi
  elif [[ "$delete_status" == "404" ]]; then
    if [[ "$delete_content_type" == text/html* ]]; then
      echo "    nota: 404 HTML, probable ruta no desplegada en esta instancia."
    else
      echo "    nota: ruta válida pero entidad/proyecto no encontrado."
    fi
  fi

  if [[ "$compare_with_payload" == "true" && ( "$delete_status" == "200" || "$delete_status" == "204" ) ]]; then
    verify_delete_status="$(run_request \
      "GET" \
      "$BASE_URL/api/v1/project/$PROJECT_ID/download/by-path/$encoded_check_path" \
      "$OUT_DIR/08_verify_delete_headers.txt" \
      "$OUT_DIR/08_verify_delete_body.bin" \
      -H "Accept: */*" \
      -H "Authorization: Bearer $token")"
    log_step "Verificar borrado GET /api/v1/project/$PROJECT_ID/download/by-path/$CHECK_PATH -> HTTP $verify_delete_status"
    if [[ "$verify_delete_status" == "404" ]]; then
      echo "    delete by-path: OK (ya no existe)"
    fi
  elif [[ "$compare_with_payload" != "true" ]]; then
    echo "    nota: no se pudo verificar borrado de fichero temporal porque el PUT inicial no tuvo éxito."
  fi

  zip_status="$(run_request \
    "GET" \
    "$BASE_URL/api/v1/project/$PROJECT_ID/download/zip" \
    "$OUT_DIR/07_download_zip_headers.txt" \
    "$OUT_DIR/07_download_zip_body.zip" \
    -H "Accept: application/zip" \
    -H "Authorization: Bearer $token")"
  log_step "/api/v1/project/$PROJECT_ID/download/zip -> HTTP $zip_status"
  if is_2xx "$zip_status"; then
    zip_size="$(wc -c < "$OUT_DIR/07_download_zip_body.zip" | tr -d ' ')"
    echo "    zip bytes: $zip_size"
  elif [[ "$zip_status" == "404" ]]; then
    zip_content_type="$(get_header_value "$OUT_DIR/07_download_zip_headers.txt" "content-type")"
    if [[ "$zip_content_type" == text/html* ]]; then
      echo "    nota: 404 HTML, probable ruta /api/v1/.../download/zip no desplegada en esta instancia."
    else
      echo "    nota: endpoint /download/zip no disponible o proyecto no encontrado."
    fi
  elif [[ "$zip_status" == "401" || "$zip_status" == "403" ]]; then
    echo "    nota: sin permisos para descargar ZIP del proyecto."
  fi

  if is_true "$WITH_COMPILED_PDF"; then
    compile_path="$sample_tex_path"
    if [[ -z "$compile_path" ]]; then
      compile_path=".montex-api-check/compile-check.tex"
      compile_payload_file="$OUT_DIR/08_compile_payload.tex"
      cat > "$compile_payload_file" <<'EOF'
\documentclass{article}
\begin{document}
Montex API compile check
\end{document}
EOF
      encoded_compile_put_path="$(urlencode "$compile_path")"
      compile_upsert_status="$(run_request \
        "PUT" \
        "$BASE_URL/api/v1/project/$PROJECT_ID/file/by-path/$encoded_compile_put_path" \
        "$OUT_DIR/08_compile_upsert_headers.txt" \
        "$OUT_DIR/08_compile_upsert_body.json" \
        -H "Accept: application/json" \
        -H "Authorization: Bearer $token" \
        -H "Content-Type: text/plain" \
        --data-binary "@$compile_payload_file")"
      log_step "Preparar tex para compile ($compile_path) -> HTTP $compile_upsert_status"
      if [[ "$compile_upsert_status" != "200" && "$compile_upsert_status" != "201" ]]; then
        compile_path=""
      fi
    fi

    if [[ -n "$compile_path" ]]; then
      encoded_compile_path="$(urlencode "$compile_path")"
      compiled_pdf_status="$(run_request \
        "GET" \
        "$BASE_URL/api/v1/project/$PROJECT_ID/download/compiled-pdf/by-path/$encoded_compile_path" \
        "$OUT_DIR/09_compiled_pdf_headers.txt" \
        "$OUT_DIR/09_compiled_pdf_body.pdf" \
        -H "Accept: application/pdf" \
        -H "Authorization: Bearer $token")"
      log_step "/api/v1/project/$PROJECT_ID/download/compiled-pdf/by-path/$compile_path -> HTTP $compiled_pdf_status"
      if is_2xx "$compiled_pdf_status"; then
        pdf_size="$(wc -c < "$OUT_DIR/09_compiled_pdf_body.pdf" | tr -d ' ')"
        echo "    compiled pdf bytes: $pdf_size"
      elif [[ "$compiled_pdf_status" == "500" ]]; then
        echo "    nota: error interno al compilar PDF (revisa clsi/compilación)."
      elif [[ "$compiled_pdf_status" == "404" ]]; then
        echo "    nota: endpoint /download/compiled-pdf/by-path no disponible."
      fi
    else
      log_step "Saltado compiled-pdf/by-path: no se encontró/preparó ruta .tex"
    fi
  else
    log_step "Saltado compiled-pdf/by-path (usa --with-compiled-pdf para activarlo)"
  fi
else
  log_step "Saltado checks de proyecto: no hay project_id disponible"
fi

echo
echo "Archivos de diagnóstico:"
find "$OUT_DIR" -maxdepth 1 -type f | sort | sed 's/^/  /'
