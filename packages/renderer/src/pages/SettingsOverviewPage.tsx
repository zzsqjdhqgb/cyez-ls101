// 设置总览页：设置注册表的只读视图，把各业务模块登记的设置项按分组元数据归并，
// 渲染为分组入口并导航到 /settings/:settingsPageId/* 详情；页面本身不持有设置状态。
import type { JSX } from 'react'
import { ArrowRight, SlidersHorizontal } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { EmptyState } from '../components/ui/EmptyState'
import { Page, PageHeader } from '../components/ui/Page'
import { useRegisteredSettingsPages, type SettingsPageRegistration } from '../app/settings-registry'
import styles from './SettingsPage.module.css'

/** 将注册的设置项按分组元数据归并，供总览页渲染。 */
interface SettingsGroup {
  id: string
  label: string
  order: number
  pages: SettingsPageRegistration[]
}

/** 优先使用显式顺序；分组未配置顺序时采用该分组首次出现的位置。 */
function groupSettingsPages(pages: readonly SettingsPageRegistration[]): SettingsGroup[] {
  const groups = new Map<string, SettingsGroup>()

  pages.forEach((page, index) => {
    const group = groups.get(page.group.id) ?? {
      id: page.group.id,
      label: page.group.label,
      order: page.group.order ?? index,
      pages: []
    }
    group.pages.push(page)
    groups.set(page.group.id, group)
  })

  // 先排列分组，再在各组内按设置项顺序排序。
  // 设置项缺少 order 时按 0 处理，排在显式声明的顺序之前。
  return [...groups.values()]
    .sort((left, right) => left.order - right.order)
    .map((group) => ({
      ...group,
      // 复制后再排序，避免就地修改归并阶段累计的数组。
      pages: [...group.pages].sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
    }))
}

/** 从设置注册表生成分组入口，并通过编码后的标识跳转到详情。 */
export function SettingsOverviewPage(): JSX.Element {
  const navigate = useNavigate()
  // 订阅注册表快照：业务模块完成登记后，本页会自动重新归并并渲染。
  const pages = useRegisteredSettingsPages()
  // 注册表为空时得到空数组，由下方空状态分支兜底。
  const groups = groupSettingsPages(pages)

  return (
    <Page>
      <PageHeader title="设置" />
      {groups.length === 0 ? (
        <EmptyState icon={SlidersHorizontal} title="暂无设置项" />
      ) : (
        <div className={styles.groups}>
          {groups.map((group) => (
            <section className={styles.group} key={group.id}>
              <h2 className={styles.groupTitle}>{group.label}</h2>
              <div className={styles.list}>
                {group.pages.map((page) => {
                  // JSX 要求组件标识符首字母大写，因此先从注册项取出图标组件。
                  const Icon = page.icon
                  // 详情路由为 /settings/:settingsPageId/*，页面标识编码后再拼接。
                  return (
                    <button
                      className={styles.item}
                      key={page.id}
                      onClick={() => navigate(`/settings/${encodeURIComponent(page.id)}`)}
                      type="button"
                    >
                      <span className={styles.itemIcon}>
                        <Icon aria-hidden="true" />
                      </span>
                      <span className={styles.itemText}>
                        <span className={styles.itemTitle}>{page.title}</span>
                        {page.description ? (
                          <span className={styles.itemDescription}>{page.description}</span>
                        ) : null}
                      </span>
                      <ArrowRight aria-hidden="true" className={styles.itemArrow} />
                    </button>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </Page>
  )
}
