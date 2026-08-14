import { useEffect, useState, type JSX } from 'react'
import { ExternalLink } from 'lucide-react'
import { SettingsContent, SettingsSection } from '../../components/settings/SettingsContent'
import { appIconUrl, catAvatarUrl, zhoufeiAvatarUrl, zoujuanAvatarUrl } from '../../assets'
import styles from './AboutSettingsPage.module.css'

const projectUrl = 'https://github.com/zzsqjdhqgb/cyez-ls101'

interface Person {
  name: string
  role: string
  avatarUrl: string
  profileUrl?: string
}

const initiator: Person = {
  name: '周飞',
  role: '项目发起人 · 上海市曹杨第二中学校长',
  avatarUrl: zhoufeiAvatarUrl
}

const developers: Person[] = [
  {
    name: '应昊廷',
    role: '2027届学生 开发者',
    avatarUrl: catAvatarUrl,
    profileUrl: 'https://github.com/zzsqjdhqgb'
  },
  {
    name: '邹娟',
    role: '开发者 · 上海市曹杨第二中学英语教师',
    avatarUrl: zoujuanAvatarUrl,
    profileUrl: 'https://github.com/zoujuan19900130'
  }
]

function PersonRow({ person }: { person: Person }): JSX.Element {
  const content = (
    <>
      <img className={styles.avatar} src={person.avatarUrl} alt="" />
      <span className={styles.personText}>
        <span className={styles.personName}>{person.name}</span>
        <span className={styles.personRole}>{person.role}</span>
      </span>
      {person.profileUrl ? <ExternalLink aria-hidden="true" className={styles.rowIcon} /> : null}
    </>
  )

  return person.profileUrl ? (
    <a
      aria-label={`${person.name}的 GitHub 主页`}
      className={styles.personRow}
      href={person.profileUrl}
      rel="noreferrer"
      target="_blank"
    >
      {content}
    </a>
  ) : (
    <div className={styles.personRow}>{content}</div>
  )
}

export function AboutSettingsPage(): JSX.Element {
  const [version, setVersion] = useState<string | undefined>(() =>
    window.appInfo ? undefined : '未知'
  )

  useEffect(() => {
    const appInfo = window.appInfo
    if (!appInfo) return undefined

    let active = true

    void appInfo
      .getVersion()
      .then((value) => {
        if (active) setVersion(value)
      })
      .catch(() => {
        if (active) setVersion('未知')
      })

    return () => {
      active = false
    }
  }, [])

  return (
    <SettingsContent>
      <section aria-labelledby="about-product-name" className={styles.product}>
        <img className={styles.appIcon} src={appIconUrl} alt="" />
        <div className={styles.productText}>
          <h2 id="about-product-name">曹二听说101</h2>
          <p>英语听说考试系统</p>
          <span className={styles.version}>版本 {version ?? '正在获取...'}</span>
        </div>
      </section>

      <SettingsSection title="项目发起人">
        <PersonRow person={initiator} />
      </SettingsSection>

      <SettingsSection title="开发者">
        {developers.map((developer) => (
          <PersonRow key={developer.name} person={developer} />
        ))}
      </SettingsSection>

      <SettingsSection title="版权与许可">
        <div className={styles.license}>
          <div>
            <p className={styles.copyright}>
              Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
            </p>
            <p className={styles.licenseDescription}>本软件为专有软件，使用须遵守项目许可证。</p>
          </div>
          <a className={styles.projectLink} href={projectUrl} rel="noreferrer" target="_blank">
            项目主页
            <ExternalLink aria-hidden="true" />
          </a>
        </div>
      </SettingsSection>
    </SettingsContent>
  )
}
