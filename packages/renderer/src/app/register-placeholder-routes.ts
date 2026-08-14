import {
  BookCheck,
  ClipboardCheck,
  Inbox,
  LayoutTemplate,
  PanelsTopLeft,
  Settings2,
  Shapes
} from 'lucide-react'
import { ExamLibraryPage } from '../features/exams/ExamLibraryPage'
import { ExamSessionPage } from '../features/exams/ExamSessionPage'
import { InterfaceDetailsPage } from '../features/interfaces/InterfaceDetailsPage'
import { InterfaceDraftEditorPage } from '../features/interfaces/InterfaceDraftEditorPage'
import { InterfaceDraftListPage } from '../features/interfaces/InterfaceDraftListPage'
import { InterfaceInstanceEditorPage } from '../features/interfaces/InterfaceInstanceEditorPage'
import { InterfaceListPage } from '../features/interfaces/InterfaceListPage'
import { SettingsDetailPage } from '../pages/SettingsDetailPage'
import { SettingsOverviewPage } from '../pages/SettingsOverviewPage'
import { WorkbenchPage } from '../pages/WorkbenchPage'
import { TemplateBrowserPage } from '../features/templates/TemplateBrowserPage'
import { TemplateDocumentPage } from '../features/templates/TemplateDocumentPage'
import { TemplateExamGenerationPage } from '../features/templates/TemplateExamGenerationPage'
import { TemplateFunctionDocumentPage } from '../features/templates/TemplateFunctionDocumentPage'
import { SchemaBrowserPage } from '../features/schemas/SchemaBrowserPage'
import { SchemaDefinitionPage } from '../features/schemas/SchemaDefinitionPage'
import { SchemaDraftEditorPage } from '../features/schemas/SchemaDraftEditorPage'
import { SchemaDraftLibraryPage } from '../features/schemas/SchemaDraftLibraryPage'
import { SubmissionLibraryPage } from '../features/submissions/SubmissionLibraryPage'
import { SubmissionGradingPage } from '../features/submissions/SubmissionGradingPage'
import { registerAppRoute } from './route-registry'

const unregisterRoutes = [
  // Default main navigation registration. `placement` defaults to `main`.
  registerAppRoute({
    id: 'workbench',
    path: '/',
    component: WorkbenchPage,
    layout: 'standard',
    navigation: {
      label: '工作台',
      icon: PanelsTopLeft,
      order: 0
    }
  }),

  registerAppRoute({
    id: 'interfaces',
    path: '/interfaces',
    component: InterfaceListPage,
    layout: 'standard',
    navigation: {
      label: '题型库',
      icon: Shapes,
      order: 30
    }
  }),

  registerAppRoute({
    id: 'schemas',
    path: '/schemas',
    component: SchemaBrowserPage,
    layout: 'standard',
    navigation: {
      label: '评分单元',
      icon: BookCheck,
      order: 50
    }
  }),

  registerAppRoute({
    id: 'exams',
    path: '/exams',
    component: ExamLibraryPage,
    layout: 'standard',
    navigation: {
      label: '试卷库',
      icon: ClipboardCheck,
      order: 10
    }
  }),

  registerAppRoute({
    id: 'exam-player',
    path: '/exams/player',
    component: ExamSessionPage,
    layout: 'immersive'
  }),

  registerAppRoute({
    id: 'submissions',
    path: '/submissions',
    component: SubmissionLibraryPage,
    layout: 'standard',
    navigation: {
      label: '作答记录',
      icon: Inbox,
      order: 20
    }
  }),

  registerAppRoute({
    id: 'submission-grading',
    path: '/submissions/:submissionId/grade',
    component: SubmissionGradingPage,
    layout: 'focus'
  }),

  registerAppRoute({
    id: 'templates',
    path: '/templates',
    component: TemplateBrowserPage,
    layout: 'standard',
    navigation: {
      label: '试卷模板',
      icon: LayoutTemplate,
      order: 40
    }
  }),

  registerAppRoute({
    id: 'template-function-editor',
    path: '/templates/libraries/:libraryId/functions/:functionId',
    component: TemplateFunctionDocumentPage,
    layout: 'focus'
  }),

  registerAppRoute({
    id: 'template-editor',
    path: '/templates/:templateId',
    component: TemplateDocumentPage,
    layout: 'focus'
  }),

  registerAppRoute({
    id: 'template-exam-generation',
    path: '/templates/:templateId/generate',
    component: TemplateExamGenerationPage,
    layout: 'focus'
  }),

  registerAppRoute({
    id: 'schema-draft-library',
    path: '/schemas/drafts/:libraryId',
    component: SchemaDraftLibraryPage,
    layout: 'standard'
  }),

  registerAppRoute({
    id: 'schema-draft-editor',
    path: '/schemas/drafts/:libraryId/:draftId',
    component: SchemaDraftEditorPage,
    layout: 'focus'
  }),

  registerAppRoute({
    id: 'schema-definition-editor',
    path: '/schemas/:schemaId',
    component: SchemaDefinitionPage,
    layout: 'focus'
  }),

  registerAppRoute({
    id: 'interface-drafts',
    path: '/interfaces/drafts',
    component: InterfaceDraftListPage,
    layout: 'standard'
  }),

  registerAppRoute({
    id: 'interface-draft-editor',
    path: '/interfaces/drafts/:draftId',
    component: InterfaceDraftEditorPage,
    layout: 'focus'
  }),

  registerAppRoute({
    id: 'interface-details',
    path: '/interfaces/:interfaceId',
    component: InterfaceDetailsPage,
    layout: 'standard'
  }),

  registerAppRoute({
    id: 'interface-instance-editor',
    path: '/interfaces/:interfaceId/instances/:instanceId',
    component: InterfaceInstanceEditorPage,
    layout: 'focus'
  }),

  // Footer navigation registration.
  registerAppRoute({
    id: 'settings',
    path: '/settings',
    component: SettingsOverviewPage,
    navigation: {
      label: '设置',
      icon: Settings2,
      placement: 'footer',
      order: 0
    }
  }),

  registerAppRoute({
    id: 'settings-detail',
    path: '/settings/:settingsPageId/*',
    component: SettingsDetailPage,
    layout: 'standard'
  })
]

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    unregisterRoutes.forEach((unregister) => unregister())
  })
}
