import type {
  SchemaTextExpression,
  StaticValueExpression,
  StringExpression,
  TextExpression,
  ValueExpression,
  ValueType,
  VariableRef
} from '../types'
import {
  fail,
  type CompileScope,
  type CompiledValue,
  type CompilerState,
  type ValueCell
} from './shared'

export function resolveStaticExpression(
  expression: StaticValueExpression,
  expected: ValueType,
  scope: CompileScope,
  state: CompilerState,
  path: string
): CompiledValue {
  if (expected === 'string') {
    return {
      type: 'string',
      value: resolveStringExpression(expression as StringExpression, scope, state, path)
    }
  }
  if (expected === 'number') {
    return {
      type: 'number',
      value: resolveValueExpression(
        expression as ValueExpression<'number'>,
        'number',
        scope,
        state,
        path
      ) as number
    }
  }
  return resolveFileExpression(expression as ValueExpression<'file'>, scope, state, path)
}

export function resolveStringExpression(
  expression: StringExpression,
  scope: CompileScope,
  state: CompilerState,
  path: string
): string {
  if ('parts' in expression) return resolveTextExpression(expression, scope, state, path)
  return resolveValueExpression(expression, 'string', scope, state, path) as string
}

export function resolveTextExpression(
  expression: TextExpression,
  scope: CompileScope,
  state: CompilerState,
  path: string
): string {
  return expression.parts
    .map((part, index) => {
      if (part.type === 'literal') return part.value
      return readScalarValue(
        resolveVariable(part.ref, scope, state, `${path}.parts[${index}]`),
        'string',
        `${path}.parts[${index}]`
      ) as string
    })
    .join('')
}

export function resolveValueExpression(
  expression: ValueExpression,
  expected: ValueType,
  scope: CompileScope,
  state: CompilerState,
  path: string
): string | number {
  if (expression.source === 'literal') return expression.value
  return readScalarValue(resolveVariable(expression.ref, scope, state, path), expected, path)
}

export function resolveFileExpression(
  expression: ValueExpression<'file'>,
  scope: CompileScope,
  state: CompilerState,
  path: string
): Extract<CompiledValue, { type: 'file' }> {
  if (expression.source === 'literal') {
    return { type: 'file', value: expression.value, sourceUrl: expression.value }
  }
  const source = resolveVariable(expression.ref, scope, state, path)
  const value = 'get' in source ? source.get() : source
  if (value.type !== 'file') {
    fail('UNRESOLVED_VALUE', path, { expected: 'file', actual: value.type })
  }
  return value
}

export function resolveSchemaTextExpression(
  expression: SchemaTextExpression,
  attachmentValues: ReadonlyMap<string, string>,
  scope: CompileScope,
  state: CompilerState,
  path: string
): string {
  return expression.parts
    .map((part, index) => {
      if (part.type === 'literal') return part.value
      const partPath = `${path}.parts[${index}]`
      if (part.ref.scope === 'schema-use') {
        const value = attachmentValues.get(part.ref.varName)
        if (value === undefined) {
          fail('UNRESOLVED_VALUE', partPath, { varName: part.ref.varName })
        }
        return value
      }
      return readScalarValue(
        resolveVariable(part.ref, scope, state, partPath),
        'string',
        partPath
      ) as string
    })
    .join('')
}

export function resolveRuntimeOutput(
  scope: CompileScope,
  name: string,
  expected: 'audio' | 'choice',
  path: string
): CompiledValue {
  const cell = scope.symbols.get(name)
  if (!cell || cell.type !== expected) {
    fail('UNRESOLVED_VALUE', path, { name, expected })
  }
  return cell.get()
}

function resolveVariable(
  ref: VariableRef,
  scope: CompileScope,
  state: CompilerState,
  path: string
): ValueCell | CompiledValue {
  if (ref.scope === 'local') {
    const cell = scope.symbols.get(ref.name)
    if (!cell) fail('UNRESOLVED_VALUE', path, { name: ref.name })
    return cell
  }

  const values = state.interfaceValuesByAlias.get(ref.alias)
  const value = values?.get(ref.varName)
  if (!value) {
    fail('UNRESOLVED_VALUE', path, { alias: ref.alias, varName: ref.varName })
  }
  return value.type === 'string'
    ? { type: 'string', value: value.value }
    : {
        type: 'file',
        value: value.value,
        ...(value.sourceUrl ? { sourceUrl: value.sourceUrl } : {})
      }
}

function readScalarValue(
  source: ValueCell | CompiledValue,
  expected: ValueType,
  path: string
): string | number {
  const value = 'get' in source ? source.get() : source
  if (value.type !== expected || !('value' in value)) {
    fail('UNRESOLVED_VALUE', path, { expected, actual: value.type })
  }
  return value.value
}
