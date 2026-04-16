import { useState } from 'react'
import NewProjectButtonModal from './new-project-button/new-project-button-modal'
import type { NewProjectButtonModalVariant } from './new-project-button/new-project-button-modal'
import type { Nullable } from '../../../../../types/utils'
import WelcomeMessageLink from './welcome-message-new/welcome-message-link'
import WelcomeMessageCreateNewProjectDropdown from './welcome-message-new/welcome-message-create-new-project-dropdown'
import learnLatexImage from '../images/learn-latex.svg'
import browseTemplatesImage from '../images/browse-templates.svg'
import getMeta from '@/utils/meta'
import OLPageContentCard from '@/shared/components/ol/ol-page-content-card'
import { motion } from 'motion/react'

export default function WelcomeMessage() {
  const [activeModal, setActiveModal] =
    useState<Nullable<NewProjectButtonModalVariant>>(null)

  const { wikiEnabled, templatesEnabled } = getMeta('ol-ExposedSettings')
  const welcomeCardCount =
    1 + Number(Boolean(wikiEnabled)) + Number(Boolean(templatesEnabled))
  const welcomeCardsWrapperClassName = `welcome-message-cards-wrapper${
    welcomeCardCount === 1 ? ' welcome-message-cards-wrapper-single' : ''
  }`

  return (
    <>
      <OLPageContentCard>
        <div className="welcome-new-wrapper">
          <div className="welcome text-center">
            <h2 className="welcome-title">Welcome Montex</h2>
            <div className={welcomeCardsWrapperClassName}>
              <motion.div
                className="welcome-message-card-animated"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: 0 }}
                whileHover={{ y: -4 }}
              >
                <WelcomeMessageCreateNewProjectDropdown
                  setActiveModal={(modal) => setActiveModal(modal)}
                />
              </motion.div>
              {wikiEnabled && (
                <motion.div
                  className="welcome-message-card-animated"
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6, delay: 0.1 }}
                  whileHover={{ y: -4 }}
                >
                  <WelcomeMessageLink
                    imgSrc={learnLatexImage}
                    title="Learn LaTeX with a tutorial"
                    href="/learn/latex/Learn_LaTeX_in_30_minutes"
                    target="_blank"
                  />
                </motion.div>
              )}
              {templatesEnabled && (
                <motion.div
                  className="welcome-message-card-animated"
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6, delay: 0.2 }}
                  whileHover={{ y: -4 }}
                >
                  <WelcomeMessageLink
                    imgSrc={browseTemplatesImage}
                    title="Browse templates"
                    href="/templates"
                  />
                </motion.div>
              )}
            </div>
          </div>
        </div>
      </OLPageContentCard>
      <NewProjectButtonModal
        modal={activeModal}
        onHide={() => setActiveModal(null)}
      />
    </>
  )
}
