import { useState, type JSX } from 'react'
import { Upload, Download, Trash2 } from 'lucide-react'
import { Button, Page, PageHeader } from '@ls101/desktop-ui'
import type { Schema } from '@ls101/lab-contracts'
import { formatBytes, formatTime } from '@ls101/lab-renderer'
import { useServiceList, useWorkspace } from '../session/workspace'
import {
  ActionNotice,
  EmptyList,
  ListFooter,
  QueryNotice,
  RefreshButton,
  useConfirmation
} from '../components/WorkspaceUI'
import styles from './Workspace.module.css'

export function ExamsPage(): JSX.Element {
  const { session } = useWorkspace()
  const [search, setSearch] = useState('')
  const [published, setPublished] = useState('')
  const list = useServiceList<Schema<'Exam'>>('getTeacherExams', {
    q: search || undefined,
    published: published === '' ? undefined : published === 'true'
  })
  const { action, ask, dialog } = useConfirmation()
  return (
    <Page>
      <PageHeader
        title="试卷"
        actions={
          <>
            <RefreshButton refresh={list.refresh} />
            <Button
              icon={Upload}
              variant="primary"
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  await session.importExam()
                  list.first()
                })
              }
            >
              导入试卷包
            </Button>
          </>
        }
      />
      <div className={styles.toolbar}>
        <label>
          搜索试卷
          <input
            type="search"
            value={search}
            placeholder="试卷名称"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label>
          上架状态
          <select value={published} onChange={(event) => setPublished(event.target.value)}>
            <option value="">全部</option>
            <option value="true">已上架</option>
            <option value="false">已下架</option>
          </select>
        </label>
      </div>
      <ActionNotice action={action} />
      <QueryNotice query={list} />
      <EmptyList
        visible={Boolean(list.data && !list.data.items.length)}
        title="暂无试卷，可导入主程序生成的试卷包"
      />
      {list.data?.items.length ? (
        <div className={styles.tableFrame}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>试卷</th>
                <th>状态</th>
                <th>导入时间</th>
                <th>页面 / 资源</th>
                <th>大小</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((exam) => (
                <tr key={exam.examId}>
                  <td>
                    <strong>{exam.title}</strong>
                    <small>{exam.packageId}</small>
                  </td>
                  <td>{exam.published ? '已上架' : '已下架'}</td>
                  <td>{formatTime(exam.importedAt)}</td>
                  <td>
                    {exam.pageCount} / {exam.resourceCount}
                  </td>
                  <td>{formatBytes(exam.archiveBytes)}</td>
                  <td>
                    <div className={styles.actions}>
                      <Button
                        size="small"
                        disabled={action.busy}
                        onClick={() =>
                          void action.run(async () => {
                            try {
                              await session.mutate('patchTeacherExamsExamId', {
                                path: { examId: exam.examId },
                                body: {
                                  published: !exam.published,
                                  expectedRevision: exam.revision
                                }
                              })
                            } finally {
                              list.refresh()
                            }
                          })
                        }
                      >
                        {exam.published ? '下架' : '上架'}
                      </Button>
                      <Button
                        size="small"
                        icon={Download}
                        disabled={action.busy}
                        onClick={() =>
                          void action.run(() =>
                            session.download(
                              'getTeacherExamsExamIdArchive',
                              { path: { examId: exam.examId } },
                              `${exam.title}.lsexam`
                            )
                          )
                        }
                      >
                        导出
                      </Button>
                      <Button
                        size="small"
                        icon={Trash2}
                        variant="ghost"
                        disabled={action.busy}
                        onClick={() =>
                          ask({
                            title: '删除试卷',
                            message: `删除“${exam.title}”？已收到的作答和已经开始的练习会保留。`,
                            danger: true,
                            run: async () => {
                              await session.mutate('deleteTeacherExamsExamId', {
                                path: { examId: exam.examId }
                              })
                              list.first()
                            }
                          })
                        }
                      >
                        删除
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {list.data ? <ListFooter list={list} /> : null}
      {dialog}
    </Page>
  )
}
