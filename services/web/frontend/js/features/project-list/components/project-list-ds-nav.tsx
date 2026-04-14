import { useProjectListContext } from '../context/project-list-context'
import { useTranslation } from 'react-i18next'
import CurrentPlanWidget from './current-plan-widget/current-plan-widget'
import NewProjectButton from './new-project-button'
import ProjectListTable from './table/project-list-table'
import UserNotifications from './notifications/user-notifications'
import SearchForm from './search-form'
import ProjectsDropdown from './dropdown/projects-dropdown'
import SortByDropdown from './dropdown/sort-by-dropdown'
import ProjectTools from './table/project-tools/project-tools'
import ProjectListTitle from './title/project-list-title'
import LoadMore from './load-more'
import OLCol from '@/shared/components/ol/ol-col'
import OLRow from '@/shared/components/ol/ol-row'
import { TableContainer } from '@/shared/components/table'
import DashApiError from '@/features/project-list/components/dash-api-error'
import getMeta from '@/utils/meta'
import DefaultNavbar from '@/shared/components/navbar/default-navbar'
import Footer from '@/shared/components/footer/footer'
import SidebarDsNav from '@/features/project-list/components/sidebar/sidebar-ds-nav'
import SystemMessages from '@/shared/components/system-messages'
import CookieBanner from '@/shared/components/cookie-banner'
import { motion } from 'motion/react'
import { Database, Layers, Shield } from 'lucide-react'

export function ProjectListDsNav() {
  const navbarProps = getMeta('ol-navbar')
  const footerProps = getMeta('ol-footer')
  const { t } = useTranslation()
  const {
    error,
    searchText,
    setSearchText,
    selectedProjects,
    totalProjectsCount,
    filter,
    tags,
    selectedTagId,
  } = useProjectListContext()

  const selectedTag = tags.find((tag) => tag._id === selectedTagId)
  const summaryCards = [
    {
      id: 'projects',
      label: t('projects'),
      value: totalProjectsCount,
      tone: 'primary',
      icon: Database,
    },
    {
      id: 'selected',
      label: t('selected'),
      value: selectedProjects.length,
      tone: 'teal',
      icon: Shield,
    },
    {
      id: 'tags',
      label: t('tags'),
      value: tags.length,
      tone: 'indigo',
      icon: Layers,
    },
  ]

  const tableTopArea = (
    <div className="project-dashboard-table-top pt-2 pb-3 d-md-none d-flex gap-2">
      <NewProjectButton
        id="new-project-button-projects-table"
        showAddAffiliationWidget
      />
      <SearchForm
        inputValue={searchText}
        setInputValue={setSearchText}
        filter={filter}
        selectedTag={selectedTag}
        className="project-dashboard-search overflow-hidden flex-grow-1"
      />
    </div>
  )

  return (
    <div className="project-ds-nav-page website-redesign institutional-dashboard">
      <SystemMessages />
      <DefaultNavbar
        {...navbarProps}
        customLogo={`${getMeta('ol-baseAssetPath')}img/ol-brand/montex.png`}
        showCloseIcon
      />
      <div className="project-list-wrapper">
        <SidebarDsNav />
        <div className="project-ds-nav-content-and-messages">
          <div className="project-ds-nav-content">
            <div className="project-ds-nav-main project-dashboard-shell">
              {error ? <DashApiError /> : ''}
              <UserNotifications />
              <main aria-labelledby="main-content">
                <motion.section
                  className="project-dashboard-hero"
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6 }}
                >
                  <div className="project-list-header-row">
                    <div className="project-dashboard-heading">
                      <ProjectListTitle
                        filter={filter}
                        selectedTag={selectedTag}
                        selectedTagId={selectedTagId}
                        className="text-truncate d-none d-md-block"
                      />
                      <p className="project-dashboard-subtitle">
                        {t('a_dashboard_that_follows_your_lead')}
                      </p>
                    </div>
                    <div className="project-tools">
                      <div className="d-none d-md-block">
                        {selectedProjects.length === 0 ? (
                          <CurrentPlanWidget />
                        ) : (
                          <ProjectTools />
                        )}
                      </div>
                      <div className="d-md-none">
                        <CurrentPlanWidget />
                      </div>
                    </div>
                  </div>
                  <div className="project-dashboard-stats">
                    {summaryCards.map((card, index) => {
                      const Icon = card.icon
                      return (
                        <motion.article
                          key={card.id}
                          className={`project-dashboard-stat-card tone-${card.tone}`}
                          initial={{ opacity: 0, y: 20 }}
                          whileInView={{ opacity: 1, y: 0 }}
                          viewport={{ once: true }}
                          transition={{ duration: 0.6, delay: index * 0.1 }}
                          whileHover={{ y: -4 }}
                        >
                          <div
                            className={`project-dashboard-stat-icon tone-${card.tone}`}
                          >
                            <Icon size={20} />
                          </div>
                          <div className="project-dashboard-stat-content">
                            <span className="project-dashboard-stat-label">
                              {card.label}
                            </span>
                            <strong className="project-dashboard-stat-value">
                              {card.value.toLocaleString()}
                            </strong>
                          </div>
                        </motion.article>
                      )
                    })}
                  </div>
                </motion.section>
                <div className="project-ds-nav-project-list">
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.6, delay: 0.2 }}
                  >
                    <OLRow className="project-dashboard-search-row d-none d-md-block">
                      <OLCol lg={7}>
                        <SearchForm
                          inputValue={searchText}
                          setInputValue={setSearchText}
                          filter={filter}
                          selectedTag={selectedTag}
                          className="project-dashboard-search"
                        />
                      </OLCol>
                    </OLRow>
                  </motion.div>
                  <div className="project-list-sidebar-survey-wrapper d-md-none">
                    {/* Omit the survey card in mobile view for now */}
                  </div>
                  <div className="mt-1 d-md-none">
                    <div
                      role="toolbar"
                      className="projects-toolbar"
                      aria-label={t('projects')}
                    >
                      <ProjectsDropdown />
                      <SortByDropdown />
                    </div>
                  </div>
                  <motion.div
                    className="project-dashboard-table-wrap mt-3"
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.6, delay: 0.3 }}
                  >
                    <TableContainer bordered>
                      {tableTopArea}
                      <ProjectListTable />
                    </TableContainer>
                  </motion.div>
                  <motion.div
                    className="project-dashboard-load-more mt-3"
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.6, delay: 0.4 }}
                  >
                    <LoadMore />
                  </motion.div>
                </div>
              </main>
            </div>
            <Footer {...footerProps} />
          </div>
          <CookieBanner />
        </div>
      </div>
    </div>
  )
}
