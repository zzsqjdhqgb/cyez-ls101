/**
 * 产品文档 canonical 容器入口（已停用）。
 *
 * 产品说明书已改为手写维护在 `docs/manual/`，不再由产品操作测试生成，
 * 因此"重新生成说明书并与仓库比对"这条路径已停用。本文件只作为共享渲染镜像的
 * 入口占位保留：视觉基线与说明书配图套件都以 `--entrypoint node` 复用同一个镜像。
 *
 *   yarn visual:publish / yarn visual:canonical:check
 *   yarn manual:figures:publish / yarn manual:figures:canonical:check
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.error(
    [
      '产品说明书已改为手写（docs/manual），产品操作测试不再生成说明书。',
      '本镜像是视觉基线与说明书配图共用的渲染镜像，请改用：',
      '  yarn visual:publish | yarn visual:canonical:check',
      '  yarn manual:figures:publish | yarn manual:figures:canonical:check'
    ].join('\n')
  )
  process.exit(1)
}
