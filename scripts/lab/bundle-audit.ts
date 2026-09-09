import type { Plugin } from 'vite'

export function labBundleAudit(role: 'student' | 'teacher'): Plugin {
  return {
    name: 'lab-bundle-audit',
    generateBundle() {
      const modules = [...this.getModuleIds()].map((id) => id.replaceAll('\\', '/'))
      const forbidden = modules.filter(
        (id) =>
          /\/(?:playwright|@playwright|sherpa-onnx-node|onnxruntime-node|ffmpeg-static)\//.test(
            id
          ) ||
          /\/packages\/(?:ai-|model-|pronunciation|tts|asr|airouter|grading-engine)/.test(id) ||
          (/\/packages\/schema-editor\//.test(id) &&
            !/\/schema-editor\/src\/(?:package-validation|identity|parser|validation|structure)\.ts$/.test(
              id
            )) ||
          /\/tests\//.test(id) ||
          (role === 'student' &&
            (/\/packages\/lab-server\//.test(id) ||
              /(?:node:sqlite|better-sqlite3|sqlite3)/.test(id)))
      )
      if (forbidden.length) this.error(`Forbidden lab dependencies: ${forbidden.join(', ')}`)
      this.emitFile({
        type: 'asset',
        fileName: 'dependency-audit.json',
        source: JSON.stringify(
          {
            role,
            modules: modules.map((id) => id.replace(`${process.cwd().replaceAll('\\', '/')}/`, ''))
          },
          null,
          2
        )
      })
    }
  }
}
