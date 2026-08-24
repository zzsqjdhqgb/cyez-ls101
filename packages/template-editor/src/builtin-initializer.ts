import { parseBuiltinTemplateRelease, parseFunctionLibraryRelease } from './document-parser'
import type { TemplateRepository } from './repository'
import { validateBuiltinTemplateRelease, validateFunctionLibraryRelease } from './repository'
import type { BuiltinTemplateRelease, FunctionLibraryRelease } from './types'

export interface BundledFunctionLibraryManifest {
  libraries: FunctionLibraryRelease[]
}

export interface BundledTemplateManifest {
  templates: BuiltinTemplateRelease[]
}

export class BuiltinFunctionLibraryInitializationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BuiltinFunctionLibraryInitializationError'
  }
}

export class BuiltinTemplateInitializationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BuiltinTemplateInitializationError'
  }
}

export async function initializeBuiltinTemplates(
  repository: TemplateRepository,
  manifestValue: unknown
): Promise<readonly BuiltinTemplateRelease[]> {
  const manifest = await parseAndValidateTemplateManifest(manifestValue)

  for (const release of manifest.templates) {
    await repository.registerBuiltinTemplate(release)
  }
  await repository.setActiveBuiltinTemplates(
    manifest.templates.map(({ templateId, version }) => ({ templateId, version }))
  )

  return manifest.templates
}

export async function initializeBuiltinFunctionLibraries(
  repository: TemplateRepository,
  manifestValue: unknown
): Promise<readonly FunctionLibraryRelease[]> {
  const manifest = await parseAndValidateManifest(manifestValue)

  for (const release of manifest.libraries) {
    await repository.registerBuiltinFunctionLibrary(release)
  }
  await repository.setActiveBuiltinFunctionLibraries(
    manifest.libraries.map(({ libraryId, version }) => ({ libraryId, version }))
  )

  return manifest.libraries
}

async function parseAndValidateManifest(value: unknown): Promise<BundledFunctionLibraryManifest> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Reflect.ownKeys(value).length !== 1 ||
    !Array.isArray(Reflect.get(value, 'libraries'))
  ) {
    throw new BuiltinFunctionLibraryInitializationError(
      'Bundled function library manifest is invalid'
    )
  }

  const libraries: FunctionLibraryRelease[] = []
  const libraryIds = new Set<string>()
  for (const item of Reflect.get(value, 'libraries') as unknown[]) {
    const release = parseFunctionLibraryRelease(item)
    if (!release) {
      throw new BuiltinFunctionLibraryInitializationError(
        'Bundled function library release is invalid'
      )
    }
    if (libraryIds.has(release.libraryId)) {
      throw new BuiltinFunctionLibraryInitializationError(
        `Bundled function library is duplicated: ${release.libraryId}`
      )
    }
    try {
      await validateFunctionLibraryRelease(release, 'builtin')
    } catch (error) {
      throw new BuiltinFunctionLibraryInitializationError(
        `Bundled function library ${release.libraryId} is invalid: ${errorMessage(error)}`
      )
    }
    libraryIds.add(release.libraryId)
    libraries.push(structuredClone(release))
  }

  return { libraries }
}

async function parseAndValidateTemplateManifest(value: unknown): Promise<BundledTemplateManifest> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Reflect.ownKeys(value).length !== 1 ||
    !Array.isArray(Reflect.get(value, 'templates'))
  ) {
    throw new BuiltinTemplateInitializationError('Bundled template manifest is invalid')
  }

  const templates: BuiltinTemplateRelease[] = []
  const templateIds = new Set<string>()
  for (const item of Reflect.get(value, 'templates') as unknown[]) {
    const release = parseBuiltinTemplateRelease(item)
    if (!release) {
      throw new BuiltinTemplateInitializationError('Bundled template release is invalid')
    }
    if (templateIds.has(release.templateId)) {
      throw new BuiltinTemplateInitializationError(
        `Bundled template is duplicated: ${release.templateId}`
      )
    }
    try {
      await validateBuiltinTemplateRelease(release)
    } catch (error) {
      throw new BuiltinTemplateInitializationError(
        `Bundled template ${release.templateId} is invalid: ${errorMessage(error)}`
      )
    }
    templateIds.add(release.templateId)
    templates.push(structuredClone(release))
  }

  return { templates }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
