const OPEN_ENTITY_PATH_QUERY_PARAM = 'path'
const LEGACY_OPEN_ENTITY_PATH_QUERY_PARAM = 'file'

function normalizeEntityPath(path: string) {
  return path.trim().replace(/^\/+/, '')
}

export function getOpenEntityPathFromUrl(location: Location = window.location) {
  const url = new URL(location.href)

  const pathFromQuery =
    url.searchParams.get(OPEN_ENTITY_PATH_QUERY_PARAM) ??
    url.searchParams.get(LEGACY_OPEN_ENTITY_PATH_QUERY_PARAM)

  if (!pathFromQuery) {
    return null
  }

  const normalizedPath = normalizeEntityPath(pathFromQuery)
  if (!normalizedPath) {
    return null
  }

  return normalizedPath
}

export function setOpenEntityPathInUrl(
  path: string | null,
  location: Location = window.location
) {
  const url = new URL(location.href)
  const normalizedPath = path ? normalizeEntityPath(path) : null

  if (normalizedPath) {
    if (url.searchParams.get(OPEN_ENTITY_PATH_QUERY_PARAM) === normalizedPath) {
      return
    }
    url.searchParams.set(OPEN_ENTITY_PATH_QUERY_PARAM, normalizedPath)
    url.searchParams.delete(LEGACY_OPEN_ENTITY_PATH_QUERY_PARAM)
  } else {
    if (!url.searchParams.has(OPEN_ENTITY_PATH_QUERY_PARAM)) {
      return
    }
    url.searchParams.delete(OPEN_ENTITY_PATH_QUERY_PARAM)
  }

  window.history.replaceState(window.history.state, '', url.toString())
}
