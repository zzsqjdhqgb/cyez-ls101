const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const yaml = require('js-yaml')
const Ajv = require('ajv')

const root = path.resolve(__dirname, '../..')
const api = yaml.load(fs.readFileSync(path.join(root, 'docs/lab-server.openapi.yaml'), 'utf8'))
const methods = ['get', 'post', 'put', 'patch', 'delete']

function resolve(ref) {
  assert.match(ref, /^#\//)
  return ref.slice(2).split('/').reduce((value, key) => value?.[key], api)
}

test('lab OpenAPI contract is internally consistent', () => {
  const operationIds = new Set()
  let operationCount = 0
  for (const [route, item] of Object.entries(api.paths)) {
    for (const method of methods) {
      const operation = item[method]
      if (!operation) continue
      operationCount++
      assert.ok(operation.operationId)
      assert.equal(operationIds.has(operation.operationId), false)
      operationIds.add(operation.operationId)
      assert.ok(operation.responses.default)
      const parameters = [...(item.parameters || []), ...(operation.parameters || [])]
      for (const parameter of parameters) {
        const resolved = parameter.$ref ? resolve(parameter.$ref) : parameter
        assert.ok(resolved, `missing parameter reference in ${method} ${route}`)
      }
      for (const response of Object.values(operation.responses)) {
        const resolved = response.$ref ? resolve(response.$ref) : response
        assert.ok(resolved, `missing response reference in ${method} ${route}`)
      }
    }
  }
  assert.equal(Object.keys(api.paths).length, 51)
  assert.equal(operationCount, 61)
  assert.ok(api.components.schemas.Heartbeat)
  assert.ok(api.components.schemas.DevicePatch)
  assert.ok(api.components.schemas.PasswordUpdate)
})

test('lab design documents link to existing local files', () => {
  for (const name of fs.readdirSync(path.join(root, 'docs')).filter((entry) => /^lab-.*\.md$/.test(entry))) {
    const content = fs.readFileSync(path.join(root, 'docs', name), 'utf8')
    for (const match of content.matchAll(/\]\((\.\/[^)#]+)(?:#[^)]*)?\)/g)) {
      assert.ok(fs.existsSync(path.resolve(root, 'docs', match[1])), `${name}: ${match[1]}`)
    }
  }
})

function dereference(value) {
  if (Array.isArray(value)) return value.map(dereference)
  if (!value || typeof value !== 'object') return value
  if (value.$ref) {
    const target = resolve(value.$ref)
    assert.ok(target, `missing reference: ${value.$ref}`)
    return dereference(target)
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, dereference(item)]))
}

test('backup conflict responses expose valid examples and reject wrong error classes', () => {
  const ajv = new Ajv({ allErrors: true, nullable: true })
  const routes = [
    ['/teacher/backups', 'post'],
    ['/teacher/service/mode', 'put'],
    ['/student/tasks/{id}/claim', 'post'],
    ['/student/tasks/{id}/lease', 'put']
  ]
  for (const [route, method] of routes) {
    const operation = api.paths[route][method]
    for (const [status, wrongCode] of [['409', 'SERVICE_NOT_READY'], ['503', 'RESOURCE_BUSY']]) {
      const response = operation.responses[status]
      assert.ok(response, `${method} ${route} must define ${status}`)
      const media = resolve(response.$ref).content['application/json']
      const validate = ajv.compile(dereference(media.schema))
      for (const { value } of Object.values(media.examples)) {
        assert.equal(validate(value), true, ajv.errorsText(validate.errors))
        const wrong = { error: { ...value.error, code: wrongCode } }
        assert.equal(validate(wrong), false, `${status} must reject ${wrongCode}`)
      }
      const delay = ajv.compile(resolve(response.$ref).headers['Retry-After'].schema)
      assert.equal(delay(1), true)
      for (const invalid of [0, -1, 0.5, 'soon']) assert.equal(delay(invalid), false)
    }
  }
})

test('blocker contract accepts current phases and rejects ambiguous or malformed entries', () => {
  const validate = new Ajv().compile(api.components.schemas.Blocker)
  const resourceId = '11111111-1111-4111-8111-111111111111'
  for (const kind of [
    'enrollment', 'test-run', 'history-cleanup', 'active-task-lease',
    'backup-pending', 'backup-write-barrier', 'backup-running'
  ]) assert.equal(validate({ kind, resourceId }), true)

  for (const invalid of [
    { kind: 'backup', resourceId },
    { kind: 'lease', resourceId },
    { kind: 'backup-ready', resourceId },
    { kind: 'backup-pending' },
    { kind: 'backup-pending', resourceId: 'not-a-uuid' },
    { kind: 'backup-pending', resourceId, password: 'must-not-leak' }
  ]) assert.equal(validate(invalid), false)

  assert.equal(api.components.schemas.ErrorDetails.properties.blockers.items.$ref,
    '#/components/schemas/Blocker')
  const service = api.components.schemas.ServiceState.allOf.find((item) => item.properties?.blockers)
  assert.equal(service.properties.blockers.items.$ref, '#/components/schemas/Blocker')
})
