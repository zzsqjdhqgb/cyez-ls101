import type { SchemaDefinition } from '@ls101/core-types'
import { verifySchemaDefinition } from './identity'
import { parseSchemaDefinition } from './parser'
import type { SchemaRepository } from './repository'
import { validateSchemaDefinition } from './validation'

export interface BundledSchemaManifest {
  schemas: SchemaDefinition[]
}

export class BuiltinSchemaInitializationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BuiltinSchemaInitializationError'
  }
}

export async function initializeBuiltinSchemas(
  repository: SchemaRepository,
  manifestValue: unknown
): Promise<readonly SchemaDefinition[]> {
  const manifest = await parseAndValidateManifest(manifestValue)
  const registered: SchemaDefinition[] = []
  for (const definition of manifest.schemas) {
    registered.push(await repository.registerBuiltinSchema(definition))
  }
  return registered
}

async function parseAndValidateManifest(value: unknown): Promise<BundledSchemaManifest> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Reflect.ownKeys(value).length !== 1 ||
    !Array.isArray(Reflect.get(value, 'schemas'))
  ) {
    throw new BuiltinSchemaInitializationError('内置评分单元清单无效')
  }

  const schemas: SchemaDefinition[] = []
  const schemaIds = new Set<string>()
  for (const item of Reflect.get(value, 'schemas') as unknown[]) {
    const definition = parseSchemaDefinition(item)
    if (
      !definition ||
      !validateSchemaDefinition(definition).valid ||
      !(await verifySchemaDefinition(definition))
    ) {
      throw new BuiltinSchemaInitializationError('内置评分单元定义无效')
    }
    if (schemaIds.has(definition.schemaId)) {
      throw new BuiltinSchemaInitializationError(`内置评分单元重复：${definition.schemaId}`)
    }
    schemaIds.add(definition.schemaId)
    schemas.push(structuredClone(definition))
  }
  return { schemas }
}
