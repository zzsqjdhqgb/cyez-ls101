import { parseFunctionLibraryRelease } from './document-parser'
import type { TemplateRepository } from './repository'
import { validateFunctionLibraryRelease } from './repository'
import type { FunctionLibraryRelease } from './types'

export interface BundledFunctionLibraryManifest {
  libraries: FunctionLibraryRelease[]
}

export class BuiltinFunctionLibraryInitializationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BuiltinFunctionLibraryInitializationError'
  }
}

export async function initializeBuiltinFunctionLibraries(
  repository: TemplateRepository,
  manifestValue: unknown
): Promise<readonly FunctionLibraryRelease[]> {
  const manifest = await parseAndValidateManifest(manifestValue)

  for (const release of manifest.libraries) {
    await repository.registerBuiltinFunctionLibrary(release)
  }
  for (const release of manifest.libraries) {
    await repository.setActiveBuiltinFunctionLibraryVersion(release.libraryId, release.version)
  }

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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
