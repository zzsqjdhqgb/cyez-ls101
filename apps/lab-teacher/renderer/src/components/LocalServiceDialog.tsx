import { useState, type FormEvent, type JSX } from 'react'
import { Download, FileText, FolderOpen, Play, RefreshCw, Square, Trash2 } from 'lucide-react'
import type { LocalServiceInitialization, LocalServiceStatus } from '@ls101/lab-desktop-host'
import {
  Banner,
  Button,
  CheckField,
  ConfirmModal,
  Field,
  Modal,
  ModalPanel,
  modalBackdropClassName
} from '@ls101/desktop-ui'
import { useLocalService, type LocalServiceController } from '../session/local-service'
import styles from './LocalServiceDialog.module.css'

const SERVICE_TABS = [
  ['information', '服务信息与操作'],
  ['recovery', '监听端口与备份恢复'],
  ['logs', '服务日志']
] as const

const STATES: Record<string, string> = {
  'not-installed': '未安装',
  stopped: '已停止',
  uninitialized: '等待初始化',
  running: '运行中',
  unavailable: '不可用'
}

const STATUS_FAILURES: Record<string, string> = {
  LOCAL_STATUS_NOT_READY:
    '系统服务尚未报告已停止，但本机状态连接未建立或已中断。可能仍在启动，也可能启动失败，请重新检查状态；持续出现时查看服务日志。',
  LOCAL_STATUS_ACCESS_DENIED:
    '当前账户无权连接本机状态通道。请联系管理员检查服务安装与账户权限，并查看服务日志。',
  LOCAL_STATUS_TIMEOUT:
    '本机状态通道未在规定时间内响应。服务可能繁忙或无响应，请重新检查状态并查看服务日志。',
  LOCAL_STATUS_INVALID_RESPONSE:
    '本机服务返回的状态信息不完整或无法识别。请查看服务日志，并核对教师端与服务程序版本。',
  LOCAL_SERVICE_NOT_LISTENING:
    '已读取到本机服务状态，但服务尚未监听业务请求。请查看服务日志，检查启动错误和监听端口配置。'
}

interface ConfirmationDefinition {
  operation: string
  title: string
  message: string
  danger?: boolean
}

type ConfirmationKey =
  | 'install'
  | 'uninstall'
  | 'stop'
  | 'force-stop'
  | 'export-data'
  | 'purge'
  | 'upgrade'
  | 'restore'
  | 'recover-restore'
  | 'updateSettings'
  | 'changePassword'

const CONFIRMATIONS: Record<ConfirmationKey, ConfirmationDefinition> = {
  'export-data': {
    operation: 'export-data',
    title: '导出原始服务数据',
    message:
      '服务必须已停止。将选择保存位置，复制原始数据、日志与恢复残留，并校验每个文件。副本包含学生作答和服务凭据，请保存在可信位置；本次导出不会删除原数据。'
  },
  purge: {
    operation: 'purge',
    title: '彻底清除本机服务及数据',
    message:
      '将重新校验导出副本，然后永久删除本机服务注册、已安装的服务程序和全部原始数据（包括作答、备份、凭据和恢复残留）。清除后须重新安装、初始化和入网；导出副本会保留。此操作不可撤销。',
    danger: true
  },
  'force-stop': {
    operation: 'force-stop',
    title: '强制停止本机服务',
    message:
      '将请求管理员授权，直接通过系统停止本机服务；等待约 30 秒后仍未停止时将强制结束服务进程。正在上传、备份或保存的工作可能中断，未完成的交卷需要学生重试。开机启动将关闭，服务不会自动重新启动；下次手动启动会先检查数据并进入维护模式。是否继续？',
    danger: true
  },
  updateSettings: {
    operation: 'updateSettings',
    title: '修改服务对外地址',
    message:
      '修改后，新生成的入网文件将使用新地址。已配置的教师端和学生端不会自动更新地址，请确认它们仍能连接服务。'
  },
  changePassword: {
    operation: 'changePassword',
    title: '修改管理密码',
    message: '修改后，已登录的教师端会话将失效，需要重新连接。学生端连接不受影响。'
  },
  install: {
    operation: 'install',
    title: '安装本机服务程序',
    message: '将把本机服务程序安装到系统并注册为系统服务，安装过程需要管理员授权。'
  },
  uninstall: {
    operation: 'uninstall',
    title: '卸载本机服务',
    message:
      '将移除本机的系统服务注册和开机启动设置，保留试卷、作答、备份和服务程序。卸载后学生端无法连接本机服务；可重新安装并启动以恢复使用。',
    danger: true
  },
  stop: {
    operation: 'stop',
    title: '停止本机服务',
    message:
      '请先在设备列表核对离线设备的最后上报状态。离线不表示作答已保存；在线设备仍有活动时无法继续。',
    danger: true
  },
  upgrade: {
    operation: 'upgrade',
    title: '检查备份、停止并升级本机服务',
    message:
      '请先在设备列表核对离线设备的最后上报状态。离线不表示作答已保存；在线设备仍有活动时无法继续。'
  },
  restore: {
    operation: 'restore',
    title: '以备份替换本机活动数据目录',
    message: '当前数据目录将保留，活动数据将回到备份时间点。',
    danger: true
  },
  'recover-restore': {
    operation: 'recover-restore',
    title: '恢复中断的数据目录切换',
    message: '将恢复上一次中断的数据目录切换。',
    danger: true
  }
}

interface PendingConfirmation {
  key: ConfirmationKey
  input?: unknown
}

interface LocalServiceDialogProps {
  close(): void
}

export function LocalServiceDialog({ close }: LocalServiceDialogProps): JSX.Element {
  const local = useLocalService()
  const [tab, setTab] = useState('information')
  const [logs, setLogs] = useState<string | null>(null)
  const [archive, setArchive] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [portDraft, setPortDraft] = useState<number | null>(null)
  const [showInitialization, setShowInitialization] = useState(false)
  const [pending, setPending] = useState<PendingConfirmation | null>(null)
  const [purgeText, setPurgeText] = useState('')
  const status = local.status
  const state = status?.state
  const running = state === 'running'
  const stopped = state === 'stopped'
  const installed = Boolean(state && state !== 'not-installed')
  const busy = local.busy
  const error = local.error ?? (state === 'unavailable' ? null : status?.error) ?? null
  const readLogs = (): void => {
    void local.logs().then((value) => {
      if (value !== null) setLogs(value)
    })
  }
  const confirmation = pending ? CONFIRMATIONS[pending.key] : null
  const port = portDraft ?? status?.port ?? ''
  const stateHint = !state
    ? '请先检查本机状态。状态未知时，不能修改服务信息或执行服务操作。'
    : state === 'not-installed'
      ? '请先安装服务程序，再启动服务并完成初始化。'
      : stopped
        ? '服务已停止。启动后才能读取和修改服务信息。'
        : state === 'uninitialized'
          ? '服务进程已启动，请先初始化服务信息。'
          : state === 'unavailable'
            ? '暂时无法读取服务信息，请重新检查状态或查看日志。'
            : '服务运行中，可以修改服务信息。停止或卸载前，请先结束使用并进入维护模式。'

  return (
    <>
      <Modal
        open
        onOpenChange={(open) => {
          if (!open && !busy) close()
        }}
        overlayClassName={modalBackdropClassName}
      >
        <ModalPanel
          className={styles.panel}
          title="本机服务"
          close={() => (busy ? undefined : close())}
          width="large"
        >
          <div className={styles.statusRow}>
            <strong>{state ? STATES[state] : '状态未知'}</strong>
            <span>{status?.releaseVersion ? `版本 ${status.releaseVersion}` : '版本未知'}</span>
            <Button
              disabled={busy}
              icon={RefreshCw}
              onClick={() => void local.check()}
              size="small"
            >
              {local.busy ? '处理中…' : '检查本机状态'}
            </Button>
          </div>
          {error ? <Banner tone="error">{error}</Banner> : null}
          {local.notice ? <Banner tone="success">{local.notice}</Banner> : null}

          <div role="tablist" aria-label="本机服务管理" className={styles.tabs}>
            {SERVICE_TABS.map(([id, label], index) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`local-tab-${id}`}
                aria-selected={tab === id}
                aria-controls={`local-panel-${id}`}
                tabIndex={tab === id ? 0 : -1}
                onClick={() => setTab(id)}
                onKeyDown={(event) => {
                  let next: number
                  if (event.key === 'ArrowRight') next = (index + 1) % SERVICE_TABS.length
                  else if (event.key === 'ArrowLeft')
                    next = (index + SERVICE_TABS.length - 1) % SERVICE_TABS.length
                  else if (event.key === 'Home') next = 0
                  else if (event.key === 'End') next = SERVICE_TABS.length - 1
                  else return
                  event.preventDefault()
                  const target = SERVICE_TABS[next][0]
                  setTab(target)
                  document.getElementById(`local-tab-${target}`)?.focus()
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div
            role="tabpanel"
            id="local-panel-information"
            aria-labelledby="local-tab-information"
            hidden={tab !== 'information'}
            tabIndex={0}
          >
            {state === 'unavailable' || (!state && local.error) ? (
              <section className={styles.recoveryCard} aria-labelledby="local-unavailable-heading">
                <div className={styles.recoveryContent}>
                  <h3 id="local-unavailable-heading">服务状态暂时不可用</h3>
                  <p>
                    {STATUS_FAILURES[status?.error ?? ''] ??
                      '教师端暂时无法读取本机服务的信息，尚不能确认服务是否已正常启动。'}
                  </p>
                  <ol>
                    <li>如果刚刚启动服务，请稍等几秒后重新检查状态。</li>
                    <li>如果仍不可用，读取服务日志查看启动错误。</li>
                    <li>
                      Windows：按 Win + R，输入 services.msc，查看 LS101 Lab
                      Service（LS101Lab）的状态。
                    </li>
                    <li>Linux：可在终端执行 systemctl status ls101-lab.service 查看服务状态。</li>
                  </ol>
                </div>
                <div className={styles.recoveryActions}>
                  <Button
                    disabled={busy}
                    icon={RefreshCw}
                    onClick={() => void local.check()}
                    size="small"
                  >
                    重新检查状态
                  </Button>
                  <Button
                    disabled={busy}
                    icon={FileText}
                    onClick={() => {
                      setTab('logs')
                      readLogs()
                    }}
                    size="small"
                    variant="ghost"
                  >
                    查看服务日志
                  </Button>
                  <Button
                    disabled={busy}
                    icon={Square}
                    onClick={() => setPending({ key: 'force-stop' })}
                    size="small"
                    variant="danger"
                  >
                    强制停止服务
                  </Button>
                </div>
                {status?.error ? (
                  <p className={styles.recoveryCode}>诊断代码：{status.error}</p>
                ) : null}
              </section>
            ) : null}
            <section aria-labelledby="local-actions-heading" className={styles.operationSection}>
              <h3 id="local-actions-heading" className={styles.heading}>
                服务操作
              </h3>
              <div className={styles.actions}>
                <Button
                  size="small"
                  disabled={busy || state !== 'not-installed'}
                  icon={Download}
                  onClick={() => setPending({ key: 'install' })}
                >
                  安装程序
                </Button>
                <Button
                  size="small"
                  disabled={busy || !stopped}
                  icon={Play}
                  onClick={() => void local.invoke('start')}
                >
                  启动
                </Button>
                <Button
                  size="small"
                  disabled={busy || state !== 'uninitialized'}
                  onClick={() => setShowInitialization(!showInitialization)}
                >
                  初始化
                </Button>
                <Button
                  size="small"
                  disabled={busy || !['running', 'uninitialized'].includes(state ?? '')}
                  icon={Square}
                  onClick={() => setPending({ key: 'stop' })}
                >
                  停止
                </Button>
                <Button
                  size="small"
                  disabled={busy || !running}
                  icon={Download}
                  onClick={() => setPending({ key: 'upgrade' })}
                >
                  升级服务
                </Button>
                <Button
                  size="small"
                  disabled={busy || !stopped}
                  icon={Trash2}
                  variant="danger"
                  onClick={() => setPending({ key: 'uninstall' })}
                >
                  卸载服务
                </Button>
              </div>
              <CheckField
                checked={status?.autostart ?? false}
                disabled={busy || !installed || state === 'unavailable'}
                id="local-service-autostart"
                label={status ? '开机启动本机服务' : '开机启动本机服务（未知）'}
                onChange={(event) => void local.invoke('autostart', event.target.checked)}
              />
              {showInitialization && state === 'uninitialized' ? (
                <InitializationForm local={local} busy={busy} />
              ) : null}
            </section>

            <section aria-labelledby="local-info-heading" className={styles.section}>
              <h3 id="local-info-heading" className={styles.heading}>
                服务信息
              </h3>
              <p className={styles.hint}>{stateHint}</p>
              <ServiceInformation
                key={`${state}:${status?.info?.serverId}:${status?.settings?.revision}:${status?.settings?.securityRevision}`}
                status={status}
                busy={busy}
                local={local}
                confirm={setPending}
              />
              <dl className={styles.details}>
                <dt>监听端口</dt>
                <dd>{status?.port ?? '未知'}</dd>
                <dt>服务 ID</dt>
                <dd className={styles.path}>{status?.info?.serverId ?? '未知'}</dd>
                <dt>公钥指纹</dt>
                <dd className={styles.path}>{status?.fingerprint ?? '未知'}</dd>
              </dl>
            </section>
          </div>

          <div
            role="tabpanel"
            id="local-panel-recovery"
            aria-labelledby="local-tab-recovery"
            hidden={tab !== 'recovery'}
            tabIndex={0}
          >
            <section className={styles.recoveryCard} aria-labelledby="local-disaster-heading">
              <h3 id="local-disaster-heading">故障数据导出与彻底清除</h3>
              <p className={styles.hint}>
                无法启动旧服务、无法备份或升级时，先停止服务，再导出原始目录。无法连接的服务可在“服务信息与操作”页强制停止。
                原始导出保留故障文件供抢救使用，不是可直接导入的业务备份。
              </p>
              <Button
                disabled={busy}
                icon={FolderOpen}
                onClick={() => {
                  setPurgeText('')
                  setPending({ key: 'export-data' })
                }}
              >
                导出原始数据
              </Button>
              {local.dataExport ? (
                <>
                  <p className={styles.path}>
                    已校验导出：{local.dataExport.directory}（{local.dataExport.files} 个文件）
                  </p>
                  <Field htmlFor="local-service-purge-confirm" label="输入“清除本机服务”以确认">
                    <input
                      id="local-service-purge-confirm"
                      disabled={busy}
                      value={purgeText}
                      onChange={(event) => setPurgeText(event.target.value)}
                    />
                  </Field>
                  <Button
                    disabled={busy || purgeText !== '清除本机服务'}
                    variant="danger"
                    icon={Trash2}
                    onClick={() => setPending({ key: 'purge' })}
                  >
                    彻底清除服务及数据
                  </Button>
                </>
              ) : null}
            </section>
            <p className={styles.hint}>
              以下操作仅在服务停止后可用。修改监听端口后，请核对对外地址中的端口。
            </p>
            <form
              className={styles.inlineRow}
              onSubmit={(event) => {
                event.preventDefault()
                void local.invoke('configure', { port: Number(port) })
              }}
            >
              <Field htmlFor="local-service-listen-port" label="监听端口">
                <input
                  id="local-service-listen-port"
                  disabled={busy || !stopped}
                  max={65535}
                  min={1}
                  required
                  type="number"
                  value={port}
                  placeholder="未知"
                  onChange={(event) => setPortDraft(Number(event.target.value))}
                />
              </Field>
              <Button disabled={busy || !stopped || !port || port === status?.port} type="submit">
                保存监听端口
              </Button>
            </form>
            <h3 className={styles.heading}>备份恢复</h3>
            <p className={styles.hint}>恢复后，活动数据将回到备份时间点，当前数据目录会保留。</p>
            <div className={styles.actions}>
              <Button
                disabled={busy || !stopped}
                icon={FolderOpen}
                onClick={() =>
                  void local.selectBackup().then((selected) => {
                    if (selected) setArchive(selected)
                  })
                }
              >
                选择备份
              </Button>
              <span className={styles.path}>{archive ?? '尚未选择备份'}</span>
            </div>
            <Field htmlFor="local-service-backup-password" label="备份密码">
              <input
                id="local-service-backup-password"
                disabled={busy || !stopped}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
            <div className={styles.actions}>
              <Button
                disabled={busy || !stopped || !archive || !password}
                onClick={() => {
                  setPending({ key: 'restore', input: { archive, password } })
                  setPassword('')
                }}
              >
                恢复备份
              </Button>
              <Button
                disabled={busy || !stopped}
                onClick={() => setPending({ key: 'recover-restore' })}
              >
                恢复中断操作
              </Button>
            </div>
          </div>
          <div
            role="tabpanel"
            id="local-panel-logs"
            aria-labelledby="local-tab-logs"
            hidden={tab !== 'logs'}
            tabIndex={0}
          >
            <Button disabled={busy} icon={FileText} onClick={readLogs}>
              读取日志
            </Button>
            {logs !== null ? <pre className={styles.logs}>{logs || '暂无日志'}</pre> : null}
          </div>
        </ModalPanel>
      </Modal>
      <ConfirmModal
        busy={busy}
        confirmLabel="确认"
        danger={confirmation?.danger ?? false}
        message={
          confirmation
            ? `${confirmation.message}${pending?.key === 'purge' ? ` 导出位置：${local.dataExport?.directory ?? ''}` : ''}`
            : ''
        }
        onCancel={() => setPending(null)}
        onConfirm={() => {
          const current = pending
          setPending(null)
          if (current) void local.invoke(CONFIRMATIONS[current.key].operation, current.input)
        }}
        open={pending !== null}
        title={confirmation?.title ?? ''}
      />
    </>
  )
}

function ServiceInformation({
  status,
  busy,
  local,
  confirm
}: {
  status: LocalServiceStatus | null
  busy: boolean
  local: LocalServiceController
  confirm(value: PendingConfirmation): void
}): JSX.Element {
  const settings = status?.settings
  const [name, setName] = useState(settings?.name ?? status?.info?.name ?? '')
  const [baseUrl, setBaseUrl] = useState(settings?.baseUrl ?? '')
  const [newPassword, setNewPassword] = useState('')
  const editable = status?.state === 'running' && Boolean(settings) && !busy
  const dirty = name.trim() !== settings?.name || baseUrl.trim() !== settings?.baseUrl
  const save = (event: FormEvent): void => {
    event.preventDefault()
    if (!editable || !settings) return
    const input = {
      name: name.trim(),
      baseUrl: baseUrl.trim(),
      expectedRevision: settings.revision
    }
    if (input.baseUrl !== settings.baseUrl) confirm({ key: 'updateSettings', input })
    else void local.invoke('updateSettings', input)
  }
  return (
    <>
      <form onSubmit={save}>
        <div className={styles.informationGrid}>
          <Field htmlFor="local-info-name" label="服务名称">
            <input
              id="local-info-name"
              disabled={!editable}
              required
              maxLength={200}
              placeholder="未知"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field htmlFor="local-info-url" label="对外地址">
            <input
              id="local-info-url"
              disabled={!editable}
              required
              type="url"
              placeholder="未知"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </Field>
        </div>
        <div className={styles.actions}>
          <Button disabled={!editable || !dirty || !name.trim()} type="submit">
            保存服务信息
          </Button>
          <Button
            disabled={!editable || !dirty}
            variant="ghost"
            onClick={() => {
              setName(settings!.name)
              setBaseUrl(settings!.baseUrl)
            }}
          >
            撤销修改
          </Button>
        </div>
      </form>
      <form
        className={styles.inlineRow}
        onSubmit={(event) => {
          event.preventDefault()
          if (editable && settings) {
            confirm({
              key: 'changePassword',
              input: { expectedRevision: settings.securityRevision, newPassword }
            })
            setNewPassword('')
          }
        }}
      >
        <Field htmlFor="local-info-password" label="管理密码">
          <input
            id="local-info-password"
            autoComplete="new-password"
            disabled={!editable}
            type="password"
            required
            minLength={1}
            maxLength={256}
            placeholder={editable ? '输入新密码' : '不可读取'}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
        </Field>
        <Button disabled={!editable || !newPassword} type="submit">
          修改密码
        </Button>
      </form>
    </>
  )
}

function InitializationForm({
  local,
  busy
}: {
  local: LocalServiceController
  busy: boolean
}): JSX.Element {
  const status = local.status
  const [initial, setInitial] = useState<LocalServiceInitialization>({
    name: '听说101 机房',
    baseUrl: 'https://',
    password: '',
    activationCode: '',
    port: 8443
  })
  const initialize = (event: FormEvent): void => {
    event.preventDefault()
    void local.invoke('initialize', initial)
    setInitial({ ...initial, password: '', activationCode: '' })
  }
  return (
    <form className={styles.form} onSubmit={initialize}>
      <h3 className={styles.heading}>初始化本机服务</h3>
      <fieldset disabled={busy} className={styles.fieldset}>
        <Field htmlFor="local-service-name" label="名称">
          <input
            id="local-service-name"
            maxLength={200}
            required
            value={initial.name}
            onChange={(event) => setInitial({ ...initial, name: event.target.value })}
          />
        </Field>
        <Field htmlFor="local-service-url" label="对外地址">
          <input
            id="local-service-url"
            required
            type="url"
            value={initial.baseUrl}
            onChange={(event) => setInitial({ ...initial, baseUrl: event.target.value })}
          />
        </Field>
        <Field htmlFor="local-service-port" label="监听端口">
          <input
            id="local-service-port"
            max={65535}
            min={1}
            required
            type="number"
            value={initial.port}
            onChange={(event) => setInitial({ ...initial, port: Number(event.target.value) })}
          />
        </Field>
        <Field htmlFor="local-service-password" label="管理密码">
          <input
            autoComplete="new-password"
            id="local-service-password"
            required
            type="password"
            value={initial.password}
            onChange={(event) => setInitial({ ...initial, password: event.target.value })}
          />
        </Field>
        {status?.license?.state !== 'active' ? (
          <Field htmlFor="local-service-activation" label="服务激活码">
            <input
              id="local-service-activation"
              required
              type="password"
              value={initial.activationCode}
              onChange={(event) => setInitial({ ...initial, activationCode: event.target.value })}
            />
          </Field>
        ) : null}
        <Button disabled={busy} type="submit" variant="primary">
          完成初始化
        </Button>
      </fieldset>
    </form>
  )
}
