import type {
  InterfaceVarInfo,
  SchemaBlockManifestEntry,
  SchemaFieldDef,
  SchemaFieldType
} from '@ls101/core-types'
import type {
  FrameNode,
  FunctionNode,
  FunctionOutputDef,
  SchemaBindingExpression,
  SchemaUse,
  StaticValueExpression,
  StringExpression,
  TemplateNode,
  TemplateValueType,
  TextExpression,
  ValueExpression,
  ValueType,
  VariableRef
} from '../types'
import { addError, isValidLocalName, type ScopeState, type ValidationState } from './shared'

export function validateDefinitionScope(
  body: FrameNode,
  schemaUses: readonly SchemaUse[],
  inputs: readonly { name: string; type: ValueType }[],
  outputs: readonly FunctionOutputDef[],
  path: string,
  functionStack: readonly string[],
  state: ValidationState,
  interfaceVariablesAllowed = true
): void {
  const scope: ScopeState = {
    symbols: new Map(),
    usedNames: new Map(),
    nodeIds: new Map(),
    interfaceVariablesAllowed
  }

  inputs.forEach((input, index) => {
    registerLocalName(input.name, input.type, `${path}.inputs[${index}].name`, true, scope, state)
  })
  scanScope(body, path, scope, state)
  outputs.forEach((output, index) => {
    registerLocalName(
      output.name,
      output.type,
      `${path}.outputs[${index}].name`,
      false,
      scope,
      state
    )
  })

  validateNodeExpressions(body, path, scope, functionStack, state)
  validateFunctionOutputs(outputs, `${path}.outputs`, scope, state)
  validateSchemaUses(schemaUses, `${path}.schemaUses`, scope, state)
}

function scanScope(
  node: TemplateNode,
  path: string,
  scope: ScopeState,
  state: ValidationState
): void {
  registerNodeId(node.id, `${path}.id`, scope, state)

  switch (node.type) {
    case 'frame':
      node.children.forEach((child, index) =>
        scanScope(child, `${path}.children[${index}]`, scope, state)
      )
      break
    case 'page':
      validateContentBlockIds(node, path, state)
      node.timeline.forEach((step, index) => {
        if (step.type === 'record') {
          registerLocalName(
            step.outputName,
            'audio',
            `${path}.timeline[${index}].outputName`,
            true,
            scope,
            state
          )
        }
      })
      break
    case 'choice-question':
      registerLocalName(node.outputName, 'choice', `${path}.outputName`, true, scope, state)
      validateChoiceOptions(node, path, state)
      break
    case 'function': {
      const func = state.functionsById.get(node.functionRef)
      if (!func) break
      func.outputs.forEach((output) => {
        const outputName = node.outputNames[output.name]
        if (outputName === undefined) return
        registerLocalName(
          outputName,
          output.type,
          `${path}.outputNames[${JSON.stringify(output.name)}]`,
          true,
          scope,
          state
        )
      })
      break
    }
  }
}

function registerNodeId(id: string, path: string, scope: ScopeState, state: ValidationState): void {
  if (!id.trim()) {
    addError(state, path, 'EMPTY_NODE_ID')
    return
  }
  const previous = scope.nodeIds.get(id)
  if (previous) {
    addError(state, path, 'DUPLICATE_NODE_ID', { id, previous })
    return
  }
  scope.nodeIds.set(id, path)
}

function validateContentBlockIds(
  page: Extract<TemplateNode, { type: 'page' }>,
  path: string,
  state: ValidationState
): void {
  const ids = new Map<string, string>()
  const choiceViewIds = new Set<string>()

  page.content.blocks.forEach((block, index) => {
    const blockPath = `${path}.content.blocks[${index}]`
    if (!block.id.trim()) {
      addError(state, `${blockPath}.id`, 'EMPTY_CONTENT_BLOCK_ID')
    } else if (ids.has(block.id)) {
      addError(state, `${blockPath}.id`, 'DUPLICATE_CONTENT_BLOCK_ID', {
        id: block.id,
        previous: ids.get(block.id) ?? ''
      })
    } else {
      ids.set(block.id, `${blockPath}.id`)
    }
    if (block.type === 'choice-view') choiceViewIds.add(block.id)
  })

  page.timeline.forEach((step, stepIndex) => {
    for (const blockId of Object.keys(step.choiceViewOverrides ?? {})) {
      if (!choiceViewIds.has(blockId)) {
        addError(
          state,
          `${path}.timeline[${stepIndex}].choiceViewOverrides[${JSON.stringify(blockId)}]`,
          'UNKNOWN_CHOICE_VIEW_OVERRIDE',
          { blockId }
        )
      }
    }
  })
}

function validateChoiceOptions(
  question: Extract<TemplateNode, { type: 'choice-question' }>,
  path: string,
  state: ValidationState
): void {
  if (question.options.length < 2 || question.options.length > 26) {
    addError(state, `${path}.options`, 'INVALID_CHOICE_OPTION_COUNT', {
      count: question.options.length
    })
  }

  const ids = new Set<string>()
  question.options.forEach((option, index) => {
    const optionPath = `${path}.options[${index}].id`
    if (!option.id.trim()) addError(state, optionPath, 'EMPTY_CHOICE_OPTION_ID')
    if (ids.has(option.id)) {
      addError(state, optionPath, 'DUPLICATE_CHOICE_OPTION_ID', { id: option.id })
    }
    ids.add(option.id)
  })
}

function registerLocalName(
  name: string,
  type: TemplateValueType,
  path: string,
  expose: boolean,
  scope: ScopeState,
  state: ValidationState
): void {
  if (!isValidLocalName(name)) {
    addError(state, path, 'INVALID_LOCAL_NAME', { name })
  }
  const previous = scope.usedNames.get(name)
  if (previous) {
    addError(state, path, 'DUPLICATE_LOCAL_NAME', { name, previous })
    return
  }
  scope.usedNames.set(name, path)
  if (expose) scope.symbols.set(name, { type })
}

function validateNodeExpressions(
  node: TemplateNode,
  path: string,
  scope: ScopeState,
  functionStack: readonly string[],
  state: ValidationState
): void {
  switch (node.type) {
    case 'frame':
      node.children.forEach((child, index) =>
        validateNodeExpressions(child, `${path}.children[${index}]`, scope, functionStack, state)
      )
      break
    case 'page':
      node.content.blocks.forEach((block, index) => {
        const blockPath = `${path}.content.blocks[${index}]`
        if (block.type === 'text')
          validateTextExpression(block.text, `${blockPath}.text`, scope, state)
        if (block.type === 'image') {
          validateValueExpression(block.src, 'file', `${blockPath}.src`, scope, state)
        }
      })
      node.timeline.forEach((step, index) => {
        const stepPath = `${path}.timeline[${index}]`
        if (step.type === 'play') {
          validateTextExpression(step.text, `${stepPath}.text`, scope, state)
        }
        if (step.type === 'countdown') {
          validateValueExpression(step.seconds, 'number', `${stepPath}.seconds`, scope, state)
        }
        if (step.type === 'record') {
          validateValueExpression(step.duration, 'number', `${stepPath}.duration`, scope, state)
        }
      })
      break
    case 'choice-question':
      validateTextExpression(node.stem, `${path}.stem`, scope, state)
      node.options.forEach((option, index) =>
        validateTextExpression(option.content, `${path}.options[${index}].content`, scope, state)
      )
      break
    case 'function':
      validateFunctionCall(node, path, scope, functionStack, state)
      break
  }
}

function validateFunctionCall(
  node: FunctionNode,
  path: string,
  callerScope: ScopeState,
  functionStack: readonly string[],
  state: ValidationState
): void {
  const func = state.functionsById.get(node.functionRef)
  if (!func) {
    addError(state, `${path}.functionRef`, 'UNKNOWN_FUNCTION', { functionRef: node.functionRef })
    return
  }

  const declaredInputs = new Map(func.inputs.map((input) => [input.name, input]))
  func.inputs.forEach((input) => {
    const expression = node.inputs[input.name]
    if (!expression) {
      addError(state, `${path}.inputs`, 'MISSING_FUNCTION_INPUT', { name: input.name })
      return
    }
    validateStaticExpression(
      expression,
      input.type,
      `${path}.inputs[${JSON.stringify(input.name)}]`,
      callerScope,
      state
    )
  })
  for (const name of Object.keys(node.inputs)) {
    if (!declaredInputs.has(name)) {
      addError(state, `${path}.inputs[${JSON.stringify(name)}]`, 'UNKNOWN_FUNCTION_INPUT', { name })
    }
  }

  const declaredOutputs = new Set(func.outputs.map((output) => output.name))
  func.outputs.forEach((output) => {
    if (node.outputNames[output.name] === undefined) {
      addError(state, `${path}.outputNames`, 'MISSING_FUNCTION_OUTPUT_NAME', {
        name: output.name
      })
    }
  })
  for (const name of Object.keys(node.outputNames)) {
    if (!declaredOutputs.has(name)) {
      addError(
        state,
        `${path}.outputNames[${JSON.stringify(name)}]`,
        'UNKNOWN_FUNCTION_OUTPUT_NAME',
        { name }
      )
    }
  }

  if (functionStack.includes(func.id)) {
    addError(state, `${path}.functionRef`, 'RECURSIVE_FUNCTION_CALL', {
      functionRef: func.id,
      chain: [...functionStack, func.id].join(' -> ')
    })
    return
  }

  validateDefinitionScope(
    func.body,
    func.schemaUses,
    func.inputs,
    func.outputs,
    `${path}.function.body`,
    [...functionStack, func.id],
    state,
    false
  )
}

function validateFunctionOutputs(
  outputs: readonly FunctionOutputDef[],
  path: string,
  scope: ScopeState,
  state: ValidationState
): void {
  outputs.forEach((output, index) => {
    const outputPath = `${path}[${index}].expression`
    switch (output.type) {
      case 'string':
        validateStringExpression(output.expression, outputPath, scope, state)
        break
      case 'number':
        validateValueExpression(output.expression, 'number', outputPath, scope, state)
        break
      case 'file':
        validateValueExpression(output.expression, 'file', outputPath, scope, state)
        break
      case 'audio':
        validateOutputReference(output.expression.name, 'audio', outputPath, scope, state)
        break
      case 'choice':
        validateOutputReference(output.expression.name, 'choice', outputPath, scope, state)
        break
    }
  })
}

function validateStaticExpression(
  expression: StaticValueExpression,
  expected: ValueType,
  path: string,
  scope: ScopeState,
  state: ValidationState
): void {
  if (expected === 'string') {
    validateStringExpression(expression as StringExpression, path, scope, state)
    return
  }
  validateValueExpression(
    expression as ValueExpression<'number' | 'file'>,
    expected,
    path,
    scope,
    state
  )
}

function validateStringExpression(
  expression: StringExpression,
  path: string,
  scope: ScopeState,
  state: ValidationState
): void {
  if ('parts' in expression) {
    validateTextExpression(expression, path, scope, state)
    return
  }
  validateValueExpression(expression, 'string', path, scope, state)
}

function validateTextExpression(
  expression: TextExpression,
  path: string,
  scope: ScopeState,
  state: ValidationState
): void {
  expression.parts.forEach((part, index) => {
    if (part.type !== 'variable') return
    validateVariableRef(part.ref, 'string', `${path}.parts[${index}]`, scope, state)
  })
}

function validateValueExpression(
  expression: ValueExpression,
  expected: ValueType,
  path: string,
  scope: ScopeState,
  state: ValidationState
): void {
  if (expression.type !== expected) {
    addError(state, path, 'EXPRESSION_TYPE_MISMATCH', {
      expected,
      actual: expression.type
    })
  }
  if (expression.source === 'variable') {
    validateVariableRef(expression.ref, expected, path, scope, state)
  }
}

function validateVariableRef(
  ref: VariableRef,
  expected: TemplateValueType,
  path: string,
  scope: ScopeState,
  state: ValidationState
): void {
  const actual = resolveVariableType(ref, path, scope, state)
  if (actual && actual !== expected) {
    addError(state, path, 'EXPRESSION_TYPE_MISMATCH', { expected, actual })
  }
}

function resolveVariableType(
  ref: VariableRef,
  path: string,
  scope: ScopeState,
  state: ValidationState
): TemplateValueType | undefined {
  if (ref.scope === 'local') {
    const symbol = scope.symbols.get(ref.name)
    if (!symbol) {
      addError(state, path, 'UNKNOWN_LOCAL_VARIABLE', { name: ref.name })
      return undefined
    }
    return symbol.type
  }

  if (!scope.interfaceVariablesAllowed) {
    addError(state, path, 'INTERFACE_VARIABLE_IN_FUNCTION', {
      alias: ref.alias,
      varName: ref.varName
    })
    return undefined
  }

  const requirement = state.requirementsByAlias.get(ref.alias)
  if (!requirement) {
    addError(state, path, 'UNKNOWN_INTERFACE_ALIAS', { alias: ref.alias })
    return undefined
  }
  if (!requirement.acceptedVars.has(ref.varName)) {
    addError(state, path, 'INTERFACE_VAR_NOT_ACCEPTED', {
      alias: ref.alias,
      varName: ref.varName
    })
    return undefined
  }
  const variable = requirement.manifest?.vars.find((item) => item.varName === ref.varName)
  if (!variable) return undefined
  return interfaceTypeToValueType(variable)
}

function interfaceTypeToValueType(variable: InterfaceVarInfo): ValueType {
  return variable.type === 'text' ? 'string' : 'file'
}

function validateOutputReference(
  name: string,
  expected: 'audio' | 'choice',
  path: string,
  scope: ScopeState,
  state: ValidationState
): void {
  const symbol = scope.symbols.get(name)
  if (!symbol) {
    addError(state, path, 'UNKNOWN_LOCAL_VARIABLE', { name })
    return
  }
  if (symbol.type !== expected) {
    addError(state, path, 'EXPRESSION_TYPE_MISMATCH', {
      name,
      expected,
      actual: symbol.type
    })
  }
}

function validateSchemaUses(
  uses: readonly SchemaUse[],
  path: string,
  scope: ScopeState,
  state: ValidationState
): void {
  state.schemaUseCount += uses.length
  const useIds = new Set<string>()

  uses.forEach((use, index) => {
    const usePath = `${path}[${index}]`
    if (!use.useId.trim()) {
      addError(state, `${usePath}.useId`, 'INVALID_SCHEMA_USE_ID')
    }
    if (useIds.has(use.useId)) {
      addError(state, `${usePath}.useId`, 'DUPLICATE_SCHEMA_USE_ID', { useId: use.useId })
    }
    useIds.add(use.useId)

    const schema = state.schemasById.get(use.schemaId)
    if (!schema) {
      addError(state, `${usePath}.schemaId`, 'UNKNOWN_SCHEMA', { schemaId: use.schemaId })
      return
    }
    const block = schema.blocks.find((item) => item.blockId === use.blockId)
    if (!block) {
      addError(state, `${usePath}.blockId`, 'UNKNOWN_SCHEMA_BLOCK', {
        schemaId: use.schemaId,
        blockId: use.blockId
      })
      return
    }
    validateSchemaBindings(use, block, usePath, scope, state)
  })
}

function validateSchemaBindings(
  use: SchemaUse,
  block: SchemaBlockManifestEntry,
  path: string,
  scope: ScopeState,
  state: ValidationState
): void {
  const inputs = new Map(block.inputs.map((input) => [input.inputId, input]))
  block.inputs.forEach((input) => {
    const expression = use.bindings[input.inputId]
    if (!expression) {
      addError(state, `${path}.bindings`, 'MISSING_SCHEMA_BINDING', { varName: input.inputId })
      return
    }
    validateSchemaBinding(
      expression,
      input,
      `${path}.bindings[${JSON.stringify(input.inputId)}]`,
      scope,
      state
    )
  })
  for (const varName of Object.keys(use.bindings)) {
    if (!inputs.has(varName)) {
      addError(state, `${path}.bindings[${JSON.stringify(varName)}]`, 'UNKNOWN_SCHEMA_BINDING', {
        varName
      })
    }
  }
}

function validateSchemaBinding(
  expression: SchemaBindingExpression,
  field: SchemaFieldDef,
  path: string,
  scope: ScopeState,
  state: ValidationState
): void {
  if (field.type === 'string') {
    validateStringSchemaBinding(expression, path, scope, state)
    return
  }

  const expected = field.type
  if (expected === 'audio' && expression.type === 'record-output') {
    validateOutputReference(expression.name, 'audio', path, scope, state)
    return
  }
  addSchemaTypeError(state, path, expected, expression.type)
}

function validateStringSchemaBinding(
  expression: SchemaBindingExpression,
  path: string,
  scope: ScopeState,
  state: ValidationState
): void {
  switch (expression.type) {
    case 'literal':
      if (typeof expression.value !== 'string') {
        addSchemaTypeError(state, path, 'string', 'number')
      }
      break
    case 'variable':
      validateVariableRef(expression, 'string', path, scope, state)
      break
    case 'concat':
      expression.parts.forEach((part, index) => {
        if (part.type === 'variable') {
          validateVariableRef(part, 'string', `${path}.parts[${index}]`, scope, state)
        }
      })
      break
    case 'record-output':
      addSchemaTypeError(state, path, 'string', expression.type)
      break
    case 'choice-output':
      validateOutputReference(expression.name, 'choice', path, scope, state)
      break
  }
}

function addSchemaTypeError(
  state: ValidationState,
  path: string,
  expected: SchemaFieldType,
  actual: string
): void {
  addError(state, path, 'SCHEMA_BINDING_TYPE_MISMATCH', { expected, actual })
}
