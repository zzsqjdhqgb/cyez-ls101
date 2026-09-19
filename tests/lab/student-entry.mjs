import { app } from 'electron'

app.commandLine.appendSwitch('use-fake-device-for-media-stream')
app.commandLine.appendSwitch('use-fake-ui-for-media-stream')
await import('../../out/lab-student/main/index.js')
