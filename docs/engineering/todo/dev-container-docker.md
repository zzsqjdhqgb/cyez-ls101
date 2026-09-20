<!--
status: draft
product-version: 0.4.1
audience: engineer
owner: engineering
-->

# 开发容器调用宿主 Docker：暂缓处理

当前暂不考虑从开发容器内运行 canonical 文档和视觉基线容器；本项不纳入此次修复。
CI 中直接调用 Docker 的流程仍需正常运行。

已知问题：即使开发容器能访问宿主 Docker socket，runner 使用的仓库路径仍是容器内的
`/workspace`。Docker bind mount 的源路径由宿主 daemon 解析，因此可能挂载错误目录，
并报找不到 `/workspace/scripts/visual/container-runner.mjs`。

后续需要支持此场景时，再为文档与视觉 runner 增加宿主仓库路径配置或挂载路径解析，
并验证两个流程都读取当前工作区、将产物写回正确的仓库。
