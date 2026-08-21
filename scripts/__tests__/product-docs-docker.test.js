const assert = require('node:assert/strict')
const { mkdtemp, mkdir, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { afterEach, test } = require('node:test')

const temporaryDirectories = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

test('builds stable Docker image and volume arguments from a repository root', async () => {
  const root = await repositoryFixture()
  const { dockerBuildArguments, dockerRunArguments, imageName, volumePrefix } =
    await import('../product-docs/docker.mjs')

  assert.equal(imageName(root), 'ls101-product-docs-renderer:7.2')
  assert.match(volumePrefix(root), /^ls101-product-docs-[0-9a-f]{12}-v7-2$/)
  assert.deepEqual(dockerBuildArguments(root).slice(0, 6), [
    'build',
    '--platform',
    'linux/amd64',
    '--file',
    path.join(root, 'docker', 'product-docs', 'Dockerfile'),
    '--tag'
  ])
  const runArguments = dockerRunArguments('publish', root)
  assert.ok(
    runArguments.includes(
      `type=volume,source=${volumePrefix(root)}-qwen-tts,target=/workspace/externals/ai/qwen3-tts`
    )
  )
  assert.equal(runArguments.at(-2), 'ls101-product-docs-renderer:7.2')
  assert.equal(runArguments.at(-1), 'publish')
})

test('rejects incomplete Docker actions before invoking Docker', async () => {
  const { parseDockerAction } = await import('../product-docs/docker.mjs')
  assert.throws(() => parseDockerAction([]), /build\|publish\|check/)
  assert.throws(() => parseDockerAction(['publish', '--grep', 'x']), /build\|publish\|check/)
})

test('container runner rejects a caller-supplied canonical flag', async () => {
  const { parseContainerAction } = await import('../product-docs/container-runner.mjs')
  assert.equal(parseContainerAction(['publish']), 'publish')
  assert.throws(() => parseContainerAction(['preview']), /publish\|check/)
})

async function repositoryFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'ls101-product-docs-docker-'))
  temporaryDirectories.push(root)
  await mkdir(path.join(root, 'docker', 'product-docs'), { recursive: true })
  await writeFile(path.join(root, 'docker', 'product-docs', 'renderer-version'), '7.2\n')
  await writeFile(path.join(root, 'docker', 'product-docs', 'Dockerfile'), 'FROM scratch\n')
  return root
}
