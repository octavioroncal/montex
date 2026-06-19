#!/bin/bash
set -e

ensure_owned_dir() {
  mkdir -p "$1"
  chown www-data:www-data "$1"
}

ensure_owned_dir /var/lib/overleaf/data
ensure_owned_dir /var/lib/overleaf/data/compiles
ensure_owned_dir /var/lib/overleaf/data/output
ensure_owned_dir /var/lib/overleaf/data/cache
ensure_owned_dir /var/lib/overleaf/data/template_files
ensure_owned_dir /var/lib/overleaf/data/history

# Pre-create the history bucket roots as www-data so the runtime services
# never need to create them as root on the persistent volume.
ensure_owned_dir /var/lib/overleaf/data/history/overleaf-project-blobs
ensure_owned_dir /var/lib/overleaf/data/history/overleaf-global-blobs
ensure_owned_dir /var/lib/overleaf/data/history/overleaf-chunks
ensure_owned_dir /var/lib/overleaf/data/history/overleaf-zips

ensure_owned_dir /var/lib/overleaf/tmp
ensure_owned_dir /var/lib/overleaf/tmp/projectHistories
ensure_owned_dir /var/lib/overleaf/tmp/dumpFolder
ensure_owned_dir /var/lib/overleaf/tmp/uploads
