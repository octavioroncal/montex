import { useDetachCompileContext as useCompileContext } from '@/shared/context/detach-compile-context'
import { useEffect, useState } from 'react'
import usePreviousValue from '@/shared/hooks/use-previous-value'
import getMeta from '@/utils/meta'

const RESET_AFTER_MS = 5_000
const FAVICON_VERSION = 'montex-20260413-2'
const PNG_FAVICON = `favicon-32x32.png?v=${FAVICON_VERSION}`

const COMPILE_ICONS = {
  ERROR: `favicon-error.svg?v=${FAVICON_VERSION}`,
  COMPILING: `favicon-compiling.svg?v=${FAVICON_VERSION}`,
  COMPILED: `favicon-compiled.svg?v=${FAVICON_VERSION}`,
  UNCOMPILED: `favicon.svg?v=${FAVICON_VERSION}`,
} as const

type CompileStatus = keyof typeof COMPILE_ICONS

const useCompileStatus = (): CompileStatus => {
  const compileContext = useCompileContext()
  if (compileContext.uncompiled) return 'UNCOMPILED'
  if (compileContext.compiling) return 'COMPILING'
  if (compileContext.error) return 'ERROR'
  return 'COMPILED'
}

const removeFavicon = () => {
  const existingFavicons = document.head.querySelectorAll(
    "link[rel='icon']"
  ) as NodeListOf<HTMLLinkElement>
  existingFavicons.forEach(favicon => {
    if (favicon.dataset.compileStatus === 'true') {
      favicon.parentNode?.removeChild(favicon)
    }
  })
}

const updateFavicon = (status: CompileStatus = 'UNCOMPILED') => {
  removeFavicon()
  const baseAssetPath = getMeta('ol-baseAssetPath')

  const svgLinkElement = document.createElement('link')
  svgLinkElement.rel = 'icon'
  svgLinkElement.href = baseAssetPath + COMPILE_ICONS[status]
  svgLinkElement.type = 'image/svg+xml'
  svgLinkElement.setAttribute('data-compile-status', 'true')
  document.head.appendChild(svgLinkElement)

  const pngLinkElement = document.createElement('link')
  pngLinkElement.rel = 'icon'
  pngLinkElement.href = baseAssetPath + PNG_FAVICON
  pngLinkElement.type = 'image/png'
  pngLinkElement.sizes = '32x32'
  pngLinkElement.setAttribute('data-compile-status', 'true')
  document.head.appendChild(pngLinkElement)
}

const isActive = () => !document.hidden

const useIsWindowActive = () => {
  const [isWindowActive, setIsWindowActive] = useState(isActive())
  useEffect(() => {
    const handleVisibilityChange = () => setIsWindowActive(isActive())
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])
  return isWindowActive
}

export const useStatusFavicon = () => {
  const compileStatus = useCompileStatus()
  const previousCompileStatus = usePreviousValue(compileStatus)
  const isWindowActive = useIsWindowActive()

  useEffect(() => {
    if (previousCompileStatus !== compileStatus) {
      return updateFavicon(compileStatus)
    }

    if (
      isWindowActive &&
      (compileStatus === 'COMPILED' || compileStatus === 'ERROR')
    ) {
      const timeout = setTimeout(updateFavicon, RESET_AFTER_MS)
      return () => clearTimeout(timeout)
    }
  }, [compileStatus, isWindowActive, previousCompileStatus])
}
