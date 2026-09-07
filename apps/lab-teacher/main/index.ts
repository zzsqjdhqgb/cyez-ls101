import { join } from 'node:path'
import { startLabDesktop } from '@ls101/lab-desktop-host/desktop'
declare const __LAB_VERSION__: string
startLabDesktop({
  role: 'teacher',
  preload: join(__dirname, '../preload/index.js'),
  renderer: join(__dirname, '../renderer/index.html'),
  developmentUrl: process.env.ELECTRON_RENDERER_URL,
  releaseVersion: __LAB_VERSION__
})
