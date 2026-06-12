/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

// src/preload/index.ts
import { contextBridge } from 'electron'
import { createExamBridge } from './bridges/exam.bridge'
import { createSubmissionBridge } from './bridges/submission.bridge'
import { createTemplateBridge } from './bridges/template.bridge'
import { createDraftBridge } from './bridges/draft.bridge'
import { createGradingBridge } from './bridges/grading.bridge'
import { createWindowBridge } from './bridges/window.bridge'
import { createDevBridge } from './bridges/dev.bridge'
import { createAppBridge } from './bridges/app.bridge'
import { createLicenseBridge } from './bridges/license.bridge'

contextBridge.exposeInMainWorld('electronAPI', {
  ...createExamBridge(),
  ...createSubmissionBridge(),
  ...createTemplateBridge(),
  ...createDraftBridge(),
  ...createGradingBridge(),
  ...createWindowBridge(),
  ...createDevBridge(),
  ...createAppBridge(),
  ...createLicenseBridge()
})
