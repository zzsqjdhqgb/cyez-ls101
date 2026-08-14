import { FileSchemaRepository, initializeBuiltinSchemas } from '@ls101/schema-editor'
import { builtinFileStore, fileStore } from '@ls101/file-store/renderer'

export const schemaRepository = new FileSchemaRepository(fileStore.scope('schema-editor'))

let initialization: Promise<void> | null = null

export function initializeSchemaApplication(): Promise<void> {
  if (!initialization) {
    initialization = (async () => {
      const manifest = await builtinFileStore
        .scope('schema-editor')
        .readText('builtin-schemas.json')
      if (manifest === null) throw new Error('Builtin Schema manifest is missing')
      await initializeBuiltinSchemas(schemaRepository, manifest)
    })()
  }
  return initialization
}
