import type { ArchiveEntryInfo } from '@ls101/exam-package'

/**
 * 批量容器策略：判断一个外层 ZIP 是否是"多个作答包"的容器，并选出要导入的成员。
 *
 * 默认策略（strictSubmissionBundlePolicy）只接受顶层平铺的 `.lssubmission` 条目：
 * 目录项、子目录里的作答包和其它文件一律拒绝。
 * 以后若要放宽（例如允许 `submissions/<id>.lssubmission` 子目录，或忽略无关条目），
 * 替换这个策略即可，导入流程本身不需要改动。
 */
export interface SubmissionBundlePolicy {
  /**
   * @param entries 外层归档的条目清单，已通过路径安全和重复路径校验。
   * @returns 要导入的成员条目名；返回 null 表示该归档不是本策略认可的批量容器。
   */
  selectMembers(entries: readonly ArchiveEntryInfo[]): readonly string[] | null
}

/** 顶层平铺的作答包文件名；目录项、带目录的条目和空名都不匹配。 */
export const SUBMISSION_BUNDLE_MEMBER = /^[^/\\]+\.lssubmission$/i

/** 默认策略：所有条目都必须是顶层 `.lssubmission` 文件。 */
export const strictSubmissionBundlePolicy: SubmissionBundlePolicy = {
  selectMembers(entries) {
    if (entries.length === 0) return null
    const names = entries.map((entry) => entry.name)
    return names.every((name) => SUBMISSION_BUNDLE_MEMBER.test(name)) ? names : null
  }
}
