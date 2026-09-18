# Prettier 版本策略

## 当前决策

项目将 Prettier 精确固定为 `3.8.5`：

```json
"prettier": "3.8.5"
```

不要改用 `^3.8.5`、`~3.8.5` 或 `latest`。格式化工具的补丁和次版本也可能产生
全仓库排版变化，因此 Prettier 升级必须作为独立变更评估和提交。

决策日期：2026-08-23。

## 背景

Prettier 3.9 合并了 [prettier/prettier#18827](https://github.com/prettier/prettier/pull/18827)，
改变了 TypeScript 联合类型的换行策略。只要联合成员能够放进 `printWidth`，格式化器就会
把原本逐行排列的成员收回同一个续行。

例如，3.8.5 保留以下格式：

```ts
export type PublishedInterfaceSource =
  | { type: 'published' }
  | { type: 'builtin'; builtinKey: string }
```

3.9 会改为：

<!-- prettier-ignore -->
```ts
export type PublishedInterfaceSource =
  { type: 'published' } | { type: 'builtin'; builtinKey: string }
```

该变化不影响 TypeScript 语义，但会降低长联合类型的可扫描性，并使增删成员时的 Git diff
覆盖整行。当前仓库会因此在多个既有类型声明上产生新的 `prettier/prettier` 诊断。

## 上游状态

- [prettier/prettier#19497](https://github.com/prettier/prettier/issues/19497) 请求增加保留逐行
  联合类型的选项，已按 Prettier 的选项策略关闭为 `not planned`；
- [prettier/prettier#19733](https://github.com/prettier/prettier/issues/19733) 将该行为报告为
  3.9 回归，目前仍在讨论；
- Prettier 3.9 没有提供只恢复旧联合类型布局的配置项。

## 重新评估条件

满足以下任一条件时，可以重新评估升级到 3.9 或更高版本：

- 上游调整联合类型的换行行为；
- 上游提供范围足够窄的配置项；
- 项目明确决定接受新格式及对应的一次性格式迁移。

评估必须在独立分支中进行，并至少执行：

```bash
yarn eslint . --no-cache
yarn typecheck
yarn test:vitest
```

必须使用 `--no-cache` 检查格式诊断，因为升级或回退 Prettier 后，已有 `.eslintcache` 可能
暂时保留上一版本产生的结果。如果决定接受新格式，格式化产生的源码变更应与功能改动分开
提交，便于审查和追溯。
