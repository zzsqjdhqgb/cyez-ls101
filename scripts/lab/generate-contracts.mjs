/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import openapiTS, { astToString } from 'openapi-typescript'
import prettier from 'prettier'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import standaloneCode from 'ajv/dist/standalone/index.js'
import { build } from 'esbuild'

const source = new URL('../../docs/lab-server.openapi.yaml', import.meta.url)
const target = new URL('../../packages/lab-contracts/src/', import.meta.url)
const check = process.argv.includes('--check')
const { default: yaml } = await import('js-yaml')
const api = yaml.load(await readFile(source, 'utf8'))
const types = astToString(await openapiTS(api))

function resolve(value) {
  if (!value?.$ref) return value
  return value.$ref
    .slice(2)
    .split('/')
    .reduce((parent, key) => parent[key], api)
}

const operations = Object.fromEntries(
  Object.entries(api.paths).flatMap(([route, item]) =>
    ['get', 'post', 'put', 'patch', 'delete'].flatMap((method) => {
      const operation = item[method]
      if (!operation) return []
      const body = resolve(operation.requestBody)
      return [
        [
          operation.operationId,
          {
            method: method.toUpperCase(),
            route,
            role: operation.security?.length
              ? route.startsWith('/teacher/')
                ? 'teacher'
                : 'student'
              : 'public',
            parameters: [...(item.parameters ?? []), ...(operation.parameters ?? [])].map(resolve),
            requestBody: body ?? null,
            responses: Object.fromEntries(
              Object.entries(operation.responses).map(([status, response]) => [
                status,
                resolve(response)
              ])
            )
          }
        ]
      ]
    })
  )
)

function qualify(value) {
  if (Array.isArray(value)) return value.map(qualify)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      key === '$ref' && typeof item === 'string' && item.startsWith('#/')
        ? `ls101${item}`
        : qualify(item)
    ])
  )
}
const validatorNames = {}
const validators = [false, true].map((coerceTypes) => {
  const ajv = new Ajv({
    strict: false,
    allErrors: true,
    coerceTypes,
    inlineRefs: false,
    code: { source: true }
  })
  addFormats(ajv)
  ajv.addFormat('binary', true)
  ajv.addSchema({ $id: 'ls101', components: api.components })
  return { ajv, exports: {} }
})
function register(key, schema, coerce = false) {
  const name = `v${Object.keys(validatorNames).length}`
  validatorNames[key] = name
  const group = validators[coerce ? 1 : 0]
  group.ajv.addSchema(qualify(schema), name)
  group.exports[name] = name
}
for (const name of Object.keys(api.components.schemas))
  register(`schema:${name}`, { $ref: `ls101#/components/schemas/${name}` })
for (const [id, operation] of Object.entries(operations)) {
  for (const location of ['path', 'query', 'header']) {
    const parameters = operation.parameters.filter((entry) => entry.in === location)
    const name = (entry) => (location === 'header' ? entry.name.toLowerCase() : entry.name)
    register(
      `${id}:${location}`,
      {
        type: 'object',
        properties: Object.fromEntries(parameters.map((entry) => [name(entry), entry.schema])),
        required: parameters.filter((entry) => entry.required).map(name),
        additionalProperties: location === 'header'
      },
      location !== 'path'
    )
  }
  for (const [type, media] of Object.entries(operation.requestBody?.content ?? {}))
    if (media.schema.format !== 'binary') register(`${id}:request:${type}`, media.schema)
  for (const [status, response] of Object.entries(operation.responses))
    if (response.content?.['application/json']?.schema)
      register(`${id}:response:${status}`, response.content['application/json'].schema)
}
const staticCode = await build({
  stdin: {
    contents: `const validators = {};\n${validators
      .map(
        ({ ajv, exports }) =>
          `(function(exports) {\n${standaloneCode(ajv, exports)}\n})(validators);`
      )
      .join('\n')}\nexport default validators;`,
    resolveDir: fileURLToPath(new URL('../../', import.meta.url))
  },
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  write: false
})
const generated = {
  'validators.generated.ts': `// @ts-nocheck\n// Generated from docs/lab-server.openapi.yaml. Do not edit.\n${staticCode.outputFiles[0].text}`,
  'validator-names.generated.json': JSON.stringify(validatorNames),
  'api.generated.ts': `// Generated from docs/lab-server.openapi.yaml. Do not edit.\n${types}`,
  'contract.generated.json': `${JSON.stringify({ components: api.components, operations }, null, 2)}\n`
}
if (!check) await mkdir(target, { recursive: true })
for (const [name, raw] of Object.entries(generated)) {
  const destination = new URL(name, target)
  const content = await prettier.format(raw, {
    ...(await prettier.resolveConfig(fileURLToPath(destination))),
    filepath: fileURLToPath(destination)
  })
  if (check) {
    if ((await readFile(destination, 'utf8')) !== content) {
      throw new Error(`Generated contract is stale: ${fileURLToPath(destination)}`)
    }
  } else await writeFile(destination, content)
}
console.log(
  `Lab contracts ${check ? 'checked' : 'generated'}: ${Object.keys(operations).length} operations`
)
