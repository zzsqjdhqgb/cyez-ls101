const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const yaml = require('js-yaml')

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
