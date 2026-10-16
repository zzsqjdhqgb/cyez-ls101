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
  return [...groups.values()]
    .sort((left, right) => left.order - right.order)
    .map((group) => ({
      ...group,
      pages: [...group.pages].sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
    }))
}

/** 从设置注册表生成分组入口，并通过编码后的标识跳转到详情。 */
export function SettingsOverviewPage(): JSX.Element {
  const navigate = useNavigate()
  const pages = useRegisteredSettingsPages()
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
                  const Icon = page.icon
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
