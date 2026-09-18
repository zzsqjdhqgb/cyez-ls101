import { ExternalLink, ShieldOff } from 'lucide-react'
import { useState, type JSX } from 'react'
import {
  SettingsContent,
  SettingsRow,
  SettingsSection
} from '../../components/settings/SettingsContent'
import { Button } from '../../components/ui/Button'
import { ConfirmModal } from '../../components/ui/ConfirmModal'

export function LicenseSettingsPage(): JSX.Element {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [guideError, setGuideError] = useState<string | null>(null)

  const openActivationGuide = async (): Promise<void> => {
    const license = window.license
    if (!license) {
      setGuideError('意见征集页面暂时无法打开，请重新启动软件后重试。')
      return
    }

    setGuideError(null)
    try {
      await license.openActivationGuide()
    } catch {
      setGuideError('意见征集页面暂时无法打开，请稍后重试。')
    }
  }

  const deactivate = async (): Promise<void> => {
    const license = window.license
    if (!license) {
      setError('许可证服务不可用，请重新启动软件后重试。')
      return
    }

    setBusy(true)
    setError(null)
    try {
      await license.deactivate()
    } catch {
      setError('取消激活失败，请稍后重试。')
      setBusy(false)
    }
  }

  return (
    <SettingsContent>
      <SettingsSection title="许可管理">
        <SettingsRow
          label="激活方式意见征集"
          description={guideError ?? '了解候选方案，并反馈你更能接受的激活方式。'}
        >
          <Button icon={ExternalLink} onClick={() => void openActivationGuide()}>
            参与意见征集
          </Button>
        </SettingsRow>
        <SettingsRow label="软件激活" description="当前软件已激活。">
          <Button
            icon={ShieldOff}
            variant="danger"
            onClick={() => {
              setError(null)
              setConfirmOpen(true)
            }}
          >
            取消激活
          </Button>
        </SettingsRow>
      </SettingsSection>
      <ConfirmModal
        busy={busy}
        closeOnConfirm={false}
        confirmLabel="取消激活并重启"
        danger
        error={error}
        message="当前设备上的激活信息将被删除，软件随后重新启动。再次使用时需要输入邀请码，其他软件数据不会被删除。"
        onCancel={() => {
          setConfirmOpen(false)
          setError(null)
        }}
        onConfirm={() => void deactivate()}
        open={confirmOpen}
        title="取消激活？"
      />
    </SettingsContent>
  )
}
