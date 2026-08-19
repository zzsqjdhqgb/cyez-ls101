import type {
  ChoiceGroupExpression,
  ChoiceGroupShape,
  ChoiceGroupRef,
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
  type ChoiceGroupCell,
  type ChoiceGroupContext,
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

export function resolveChoiceGroupExpression(
  expression: ChoiceGroupExpression,
  expected: ChoiceGroupShape,
  scope: CompileScope,
  state: CompilerState,
  path: string
): ChoiceGroupContext {
  const source =
    expression.source === 'global'
      ? lazyGlobalChoiceGroup(state, path)
      : scope.choiceGroups.get(expression.name)
  if (!source)
    fail('UNKNOWN_CHOICE_GROUP', path, {
      name: expression.source === 'local' ? expression.name : 'global'
    })

  const selected = selectChoiceGroup(source.get(), expression.selection, expected, path)
  assertChoiceGroupShape(selected, expected, path)
  return selected
}

export function resolveChoiceGroupRef(
  ref: ChoiceGroupRef,
  scope: CompileScope,
  path: string
): ChoiceGroupContext {
  const cell = scope.choiceGroups.get(ref.name)
  if (!cell) fail('UNKNOWN_CHOICE_GROUP', path, { name: ref.name })
  return cell.get()
}

function lazyGlobalChoiceGroup(state: CompilerState, path: string): ChoiceGroupCell {
  return {
    type: 'choice-group',
    label: `${path}.global`,
    get: () => {
      if (!state.globalChoiceGroup) fail('CHOICE_GROUP_NOT_AVAILABLE', path)
      return state.globalChoiceGroup
    }
  }
}

function selectChoiceGroup(
  source: ChoiceGroupContext,
  selection: ChoiceGroupExpression['selection'],
  expected: ChoiceGroupShape,
  path: string
): ChoiceGroupContext {
  if (selection.kind === 'all') return source
  if (selection.kind === 'question') {
    assertPageCoordinate(source, selection.pageIndex, selection.questionIndex, path)
    return {
      kind: 'question',
      pages: [[source.pages[selection.pageIndex][selection.questionIndex]]],
      pageIndices: [source.pageIndices[selection.pageIndex]]
    }
  }

  if (!Number.isInteger(selection.startPage) || selection.startPage < 0) {
    fail('CHOICE_GROUP_OUT_OF_RANGE', path, { startPage: selection.startPage })
  }
  if (expected.kind !== 'range') {
    fail('CHOICE_GROUP_SHAPE_MISMATCH', path, {
      expected: JSON.stringify(expected),
      actual: JSON.stringify({ kind: 'range' })
    })
  }
  const endPage = selection.startPage + expected.pageCounts.length
  if (endPage > source.pages.length) {
    fail('CHOICE_GROUP_OUT_OF_RANGE', path, { startPage: selection.startPage })
  }
  return {
    kind: 'range',
    pages: source.pages.slice(selection.startPage, endPage),
    pageIndices: source.pageIndices.slice(selection.startPage, endPage)
  }
}

function assertPageCoordinate(
  source: ChoiceGroupContext,
  pageIndex: number,
  questionIndex: number,
  path: string
): void {
  if (
    !Number.isInteger(pageIndex) ||
    !Number.isInteger(questionIndex) ||
    pageIndex < 0 ||
    pageIndex >= source.pages.length ||
    questionIndex < 0 ||
    questionIndex >= source.pages[pageIndex].length
  ) {
    fail('CHOICE_GROUP_OUT_OF_RANGE', path, { pageIndex, questionIndex })
  }
}

function assertChoiceGroupShape(
  actual: ChoiceGroupContext,
  expected: ChoiceGroupShape,
  path: string
): void {
  const actualPageCounts = actual.pages.map((page) => page.length)
  if (
    actual.kind !== expected.kind ||
    (expected.kind !== 'question' &&
      actualPageCounts.some((count, index) => count !== expected.pageCounts[index])) ||
    (expected.kind !== 'question' && actualPageCounts.length !== expected.pageCounts.length)
  ) {
    fail('CHOICE_GROUP_SHAPE_MISMATCH', path, {
      expected: JSON.stringify(expected),
      actual: JSON.stringify({ kind: actual.kind, pageCounts: actualPageCounts })
    })
  }
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
