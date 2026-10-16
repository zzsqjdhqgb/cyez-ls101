// 模板功能保留原导出入口，实际离开拦截逻辑统一复用公共 Hook。
export {
  useUnsavedChangesGuard,
  type UnsavedChangesGuard
} from '../../hooks/useUnsavedChangesGuard'
