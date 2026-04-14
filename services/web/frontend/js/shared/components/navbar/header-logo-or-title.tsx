import type { DefaultNavbarMetadata } from '@/shared/components/types/default-navbar-metadata'
import getMeta from '@/utils/meta'

export default function HeaderLogoOrTitle({
  overleafLogo,
  customLogo,
  title,
}: Pick<DefaultNavbarMetadata, 'customLogo' | 'title'> & {
  overleafLogo?: string
}) {
  const { appName } = getMeta('ol-ExposedSettings')
  const logoUrl = customLogo?.trim() || overleafLogo?.trim()
  return (
    <a href="/" aria-label={appName} className="navbar-brand">
      {(logoUrl || !title) && (
        <div
          className="navbar-logo"
          style={logoUrl ? { backgroundImage: `url("${logoUrl}")` } : {}}
        />
      )}
      {title && !logoUrl && (
        <div className="navbar-title">
          <span>{title}</span>
        </div>
      )}
    </a>
  )
}
