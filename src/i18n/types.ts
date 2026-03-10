import type commonEn from '../../public/locales/en/common.json'
import type navEn from '../../public/locales/en/nav.json'
import type settingsEn from '../../public/locales/en/settings.json'
import type planEn from '../../public/locales/en/plan.json'
import type tasksEn from '../../public/locales/en/tasks.json'
import type dashboardEn from '../../public/locales/en/dashboard.json'
import type dialogsEn from '../../public/locales/en/dialogs.json'
import type authEn from '../../public/locales/en/auth.json'
import type errorsEn from '../../public/locales/en/errors.json'
import type environmentsEn from '../../public/locales/en/environments.json'
import type projectsEn from '../../public/locales/en/projects.json'
import type workflowsEn from '../../public/locales/en/workflows.json'
import type initiativesEn from '../../public/locales/en/initiatives.json'
import type communityEn from '../../public/locales/en/community.json'
import type examplesEn from '../../public/locales/en/examples.json'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common'
    resources: {
      common: typeof commonEn
      nav: typeof navEn
      settings: typeof settingsEn
      plan: typeof planEn
      tasks: typeof tasksEn
      dashboard: typeof dashboardEn
      dialogs: typeof dialogsEn
      auth: typeof authEn
      errors: typeof errorsEn
      environments: typeof environmentsEn
      projects: typeof projectsEn
      workflows: typeof workflowsEn
      initiatives: typeof initiativesEn
      community: typeof communityEn
      examples: typeof examplesEn
    }
  }
}
