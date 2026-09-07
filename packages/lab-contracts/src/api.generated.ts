// Generated from docs/lab-server.openapi.yaml. Do not edit.
export interface paths {
  '/info': {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path?: never
      cookie?: never
    }
    get: operations['getInfo']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/teacher/sessions': {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    post: operations['postTeacherSessions']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/teacher/sessions/current': {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    post?: never
    delete: operations['deleteTeacherSessionsCurrent']
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/teacher/security': {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path?: never
      cookie?: never
    }
    get: operations['getTeacherSecurity']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/teacher/security/password': {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path?: never
      cookie?: never
    }
    get?: never
    put: operations['putTeacherSecurityPassword']
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/teacher/service': {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path?: never
      cookie?: never
    }
    get: operations['getTeacherService']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/teacher/service/mode': {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path?: never
      cookie?: never
    }
    get?: never
    /** @description Exiting maintenance checks the current revision and all blockers. A pending or running backup returns 409 RESOURCE_BUSY with details.blockers, including during its write barrier. Initialization or unavailable storage may still return 503. */
    put: operations['putTeacherServiceMode']
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/student/state': {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path?: never
      cookie?: never
    }
    get: operations['getStudentState']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/student/heartbeat': {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    post: operations['postStudentHeartbeat']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/teacher/devices': {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path?: never
      cookie?: never
    }
    get: operations['getTeacherDevices']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/teacher/devices/{id}': {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path: {
        id: components['parameters']['Id']
      }
      cookie?: never
    }
    get: operations['getTeacherDevicesId']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch: operations['patchTeacherDevicesId']
    trace?: never
  }
  '/teacher/devices/{id}/reset-binding': {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path: {
        id: components['parameters']['Id']
      }
      cookie?: never
    }
    get?: never
    put?: never
    post: operations['postTeacherDevicesIdResetBinding']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/teacher/enrollments': {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path?: never
      cookie?: never
    }
    get: operations['getTeacherEnrollments']
    put?: never
    post: operations['postTeacherEnrollments']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/teacher/enrollments/{id}': {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path: {
        id: components['parameters']['Id']
      }
      cookie?: never
    }
    get?: never
    put?: never
    post?: never
    delete: operations['deleteTeacherEnrollmentsId']
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/teacher/enrollments/{id}/file': {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path: {
        id: components['parameters']['Id']
      }
      cookie?: never
    }
    get: operations['getTeacherEnrollmentsIdFile']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/enrollment/devices/{installationId}': {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path: {
        installationId: string
      }
      cookie?: never
    }
    get?: never
    put: operations['putEnrollmentDevicesInstallationId']
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/teacher/exams': {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path?: never
      cookie?: never
    }
    get: operations['getTeacherExams']
    put?: never
    post: operations['postTeacherExams']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/teacher/exams/{examId}': {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path: {
        examId: components['parameters']['ExamId']
      }
      cookie?: never
    }
    get: operations['getTeacherExamsExamId']
    put?: never
    post?: never
    delete: operations['deleteTeacherExamsExamId']
    options?: never
    head?: never
    patch: operations['patchTeacherExamsExamId']
    trace?: never
  }
  '/teacher/exams/{examId}/archive': {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path: {
        examId: components['parameters']['ExamId']
      }
      cookie?: never
    }
    get: operations['getTeacherExamsExamIdArchive']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/student/exams': {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path?: never
      cookie?: never
    }
    get: operations['getStudentExams']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/student/exams/{examId}/archive': {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path: {
        examId: components['parameters']['ExamId']
      }
      cookie?: never
    }
    get: operations['getStudentExamsExamIdArchive']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/student/practices/{submissionId}': {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path: {
        submissionId: components['parameters']['SubmissionId']
      }
      cookie?: never
    }
    get?: never
    put: operations['putStudentPracticesSubmissionId']
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/student/submissions/{submissionId}': {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path: {
        submissionId: components['parameters']['SubmissionId']
      }
      cookie?: never
    }
    get?: never
    put: operations['putStudentSubmissionsSubmissionId']
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/student/submissions/{submissionId}/receipt': {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path: {
        submissionId: components['parameters']['SubmissionId']
      }
      cookie?: never
    }
    get: operations['getStudentSubmissionsSubmissionIdReceipt']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/teacher/submissions': {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path?: never
      cookie?: never
    }
    get: operations['getTeacherSubmissions']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/teacher/submissions/{id}': {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path: {
        id: components['parameters']['Id']
      }
      cookie?: never
    }
    get: operations['getTeacherSubmissionsId']
    put?: never
    post?: never
    delete: operations['deleteTeacherSubmissionsId']
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/teacher/submissions/{id}/archive': {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path: {
        id: components['parameters']['Id']
      }
      cookie?: never
    }
    get: operations['getTeacherSubmissionsIdArchive']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/teacher/submissions/export': {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    post: operations['postTeacherSubmissionsExport']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/teacher/submissions/delete': {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    post: operations['postTeacherSubmissionsDelete']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/student/tasks': {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path?: never
      cookie?: never
    }
    get: operations['getStudentTasks']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/student/tasks/{id}/claim': {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path: {
        id: components['parameters']['Id']
      }
      cookie?: never
    }
    get?: never
    put?: never
    /** @description Requires maintenance, matching version, enabled device and the current heartbeat runtime. Backup reservation or encryption returns 409 RESOURCE_BUSY with relevant blockers and Retry-After. A closed write gate returns 503 SERVICE_NOT_READY without issuing a lease. Other mode, runtime or task eligibility conflicts return 409 RESOURCE_BUSY. Retry only after the delay, refreshed state, successful heartbeat and local idle checks. */
    post: operations['postStudentTasksIdClaim']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/student/tasks/{id}/lease': {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path: {
        id: components['parameters']['Id']
      }
      cookie?: never
    }
    get?: never
    /** @description A closed write gate returns 503 SERVICE_NOT_READY without extending the lease. Otherwise an expired/cancelled lease, wrong runtime or normal mode returns 409 RESOURCE_BUSY. Any renewal failure stops new side effects and releases audio resources; Retry-After never extends the lease or authorizes resuming stopped execution. */
    put: operations['putStudentTasksIdLease']
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/student/tasks/{id}/result': {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path: {
        id: components['parameters']['Id']
      }
      cookie?: never
    }
    get?: never
    put: operations['putStudentTasksIdResult']
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/teacher/test-suites': {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path?: never
      cookie?: never
    }
    get: operations['getTeacherTestSuites']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/teacher/test-runs': {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path?: never
      cookie?: never
    }
    get: operations['getTeacherTestRuns']
    put?: never
    post: operations['postTeacherTestRuns']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/teacher/test-runs/{id}': {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path: {
        id: components['parameters']['Id']
      }
      cookie?: never
    }
    get: operations['getTeacherTestRunsId']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/teacher/test-runs/{id}/cancel': {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path: {
        id: components['parameters']['Id']
      }
      cookie?: never
    }
    get?: never
    put?: never
    post: operations['postTeacherTestRunsIdCancel']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/teacher/test-runs/{id}/report': {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path: {
        id: components['parameters']['Id']
      }
      cookie?: never
    }
    get: operations['getTeacherTestRunsIdReport']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/teacher/test-runs/{id}/devices/{deviceId}/confirmation': {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path: {
        id: components['parameters']['Id']
        deviceId: string
      }
      cookie?: never
    }
    get?: never
    put: operations['putTeacherTestRunsIdDevicesDeviceIdConfirmation']
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/student/tasks/{taskId}/test/exam': {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
        'X-LS101-Task-Lease': components['parameters']['TaskLease']
      }
      path: {
        taskId: components['parameters']['TaskId']
      }
      cookie?: never
    }
    get: operations['getStudentTasksTaskIdTestExam']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/student/tasks/{taskId}/test/submission': {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
        'X-LS101-Task-Lease': components['parameters']['TaskLease']
      }
      path: {
        taskId: components['parameters']['TaskId']
      }
      cookie?: never
    }
    get?: never
    put: operations['putStudentTasksTaskIdTestSubmission']
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/student/tasks/{taskId}/test/receipt': {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
        'X-LS101-Task-Lease': components['parameters']['TaskLease']
      }
      path: {
        taskId: components['parameters']['TaskId']
      }
      cookie?: never
    }
    get: operations['getStudentTasksTaskIdTestReceipt']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/teacher/history-cleanups': {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path?: never
      cookie?: never
    }
    get: operations['getTeacherHistoryCleanups']
    put?: never
    post: operations['postTeacherHistoryCleanups']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/teacher/history-cleanups/{id}': {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path: {
        id: components['parameters']['Id']
      }
      cookie?: never
    }
    get: operations['getTeacherHistoryCleanupsId']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/teacher/history-cleanups/{id}/confirm': {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path: {
        id: components['parameters']['Id']
      }
      cookie?: never
    }
    get?: never
    put?: never
    post: operations['postTeacherHistoryCleanupsIdConfirm']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/teacher/history-cleanups/{id}/cancel': {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path: {
        id: components['parameters']['Id']
      }
      cookie?: never
    }
    get?: never
    put?: never
    post: operations['postTeacherHistoryCleanupsIdCancel']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/teacher/settings': {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path?: never
      cookie?: never
    }
    get: operations['getTeacherSettings']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch: operations['patchTeacherSettings']
    trace?: never
  }
  '/teacher/logs': {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path?: never
      cookie?: never
    }
    get: operations['getTeacherLogs']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/teacher/backups': {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path?: never
      cookie?: never
    }
    get: operations['getTeacherBackups']
    put?: never
    /** @description Requires maintenance and no conflicting execution, valid lease or unfinished backup. The acceptance transaction persists a backup reservation before returning 202. Normal mode returns 409 RESOURCE_BUSY with details.mode and modeRevision; conflicts return 409 RESOURCE_BUSY with details.blockers, even during another backup's write barrier. Authorized same-key/same-input replay returns the original 202 and backup ID without enqueueing again; read its current state using GET. Different input returns CONTENT_CONFLICT. Failed jobs require a new key and password input. Initialization/storage failures return 503. */
    post: operations['postTeacherBackups']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/teacher/backups/{id}': {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path: {
        id: components['parameters']['Id']
      }
      cookie?: never
    }
    get: operations['getTeacherBackupsId']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/teacher/backups/{id}/archive': {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path: {
        id: components['parameters']['Id']
      }
      cookie?: never
    }
    /** @description Only ready backups are downloadable; all other states return 409 RESOURCE_BUSY. */
    get: operations['getTeacherBackupsIdArchive']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
}
export type webhooks = Record<string, never>
export interface components {
  schemas: {
    PositiveInteger: number
    Count: number
    Digest: string
    NullableDigest: string | null
    NullableLabel: string | null
    /** Format: date-time */
    NullableTime: string | null
    Ids: string[]
    Revision: {
      revision: components['schemas']['PositiveInteger']
    }
    Page: {
      nextCursor: string | null
    }
    Info: {
      /** Format: uuid */
      serverId: string
      name: string
      /** @enum {integer} */
      apiVersion: 1
      releaseVersion: string
      /** Format: date-time */
      serverTime: string
      /** @enum {string} */
      readiness: 'ready' | 'initializing' | 'upgrading' | 'unavailable' | 'license-inactive'
    }
    SessionRequest: {
      password?: string
    }
    Session: {
      token: string
      /** Format: date-time */
      expiresAt: string
      /** Format: uuid */
      serverId: string
    }
    PasswordUpdate: {
      newPassword: string
      expectedRevision: components['schemas']['PositiveInteger']
    }
    ModeUpdate: {
      /** @enum {string} */
      mode: 'normal' | 'maintenance'
      expectedRevision: number
    }
    Mode: {
      /** @enum {string} */
      mode: 'normal' | 'maintenance'
      modeRevision: components['schemas']['PositiveInteger']
    }
    /** @description One entry per (kind, resourceId). A backup has exactly one current blocker: backup-pending before write admission closes, backup-write-barrier while draining/copying, or backup-running during encryption/publication after the gate reopens. Ready/failed backups do not block. Student errors include only blockers relevant to that request. */
    Blocker: {
      /** @enum {string} */
      kind:
        | 'enrollment'
        | 'test-run'
        | 'history-cleanup'
        | 'active-task-lease'
        | 'backup-pending'
        | 'backup-running'
        | 'backup-write-barrier'
      /**
       * Format: uuid
       * @description Enrollment, test run, cleanup plan, active lease or backup ID, according to kind.
       */
      resourceId: string
    }
    ServiceState: components['schemas']['Info'] &
      components['schemas']['Mode'] & {
        /** Format: uuid */
        openEnrollment: string | null
        activeTasks: components['schemas']['Task'][]
        blockers: components['schemas']['Blocker'][]
        deviceSummary: {
          total: components['schemas']['Count']
          online: components['schemas']['Count']
          versionMismatch: components['schemas']['Count']
          practicing: components['schemas']['Count']
          unknownStatistics: components['schemas']['Count']
        }
        storage: components['schemas']['StorageSummary']
      }
    Device: {
      /** Format: uuid */
      id: string
      number: string
      room: components['schemas']['NullableLabel']
      seat: components['schemas']['NullableLabel']
      displayName: components['schemas']['NullableLabel']
      enabled: boolean
      revision: components['schemas']['PositiveInteger']
    }
    DevicePatch: {
      number?: string
      room?: components['schemas']['NullableLabel']
      seat?: components['schemas']['NullableLabel']
      displayName?: components['schemas']['NullableLabel']
      enabled?: boolean
      expectedRevision: components['schemas']['PositiveInteger']
    }
    DeviceDetails: components['schemas']['Device'] & {
      computerName: string
      /** @enum {string} */
      platform: 'win32' | 'linux'
      /** Format: date-time */
      registeredAt: string
      online: boolean
      lastHeartbeatAt: components['schemas']['NullableTime']
      heartbeat: components['schemas']['HeartbeatObservation']
      submissionSummaryUpdatedAt: components['schemas']['NullableTime']
      tasks: components['schemas']['Task'][]
    }
    DeviceList: components['schemas']['Page'] & {
      items: components['schemas']['DeviceDetails'][]
    }
    Limits: {
      maxExamArchiveBytes: components['schemas']['PositiveInteger']
      maxSubmissionArchiveBytes: components['schemas']['PositiveInteger']
      maxUncompressedBytes: components['schemas']['PositiveInteger']
      maxArchiveFiles: components['schemas']['PositiveInteger']
    }
    StudentState: components['schemas']['Mode'] & {
      /** Format: uuid */
      serverId: string
      /** Format: date-time */
      serverTime: string
      releaseVersion: string
      device: components['schemas']['Device']
      /** @enum {string} */
      availability:
        | 'ready'
        | 'maintenance'
        | 'version-mismatch'
        | 'disabled'
        | 'license-inactive'
        | 'service-unavailable'
      allowedOperations: (
        | 'heartbeat'
        | 'browse-exams'
        | 'download-exam'
        | 'start-practice'
        | 'submit'
        | 'query-receipt'
        | 'maintenance-task'
        | 'report-task-result'
      )[]
      heartbeatIntervalSeconds: components['schemas']['PositiveInteger']
      offlineAfterSeconds: components['schemas']['PositiveInteger']
      limits: components['schemas']['Limits']
    }
    SubmissionSummary: {
      waitingFirstUpload: components['schemas']['Count']
      unconfirmed: components['schemas']['Count']
      failed: components['schemas']['Count']
    }
    Candidate: {
      candidateId: string
      displayName: string
    }
    CurrentPractice: {
      /** Format: uuid */
      submissionId: string
      /** Format: uuid */
      examId: string
      candidate: components['schemas']['Candidate']
      pageIndex: number | null
      stepIndex: number | null
    } | null
    DiagnosticError: {
      code: string
      message: string
      /** Format: date-time */
      occurredAt: string
    } | null
    Heartbeat: {
      /** Format: uuid */
      runtimeId: string
      runtimeGeneration: components['schemas']['PositiveInteger']
      sequence: components['schemas']['PositiveInteger']
      /** @enum {string} */
      activationState: 'active' | 'inactive'
      /** @enum {string} */
      phase:
        | 'idle'
        | 'preparing'
        | 'practicing'
        | 'saving'
        | 'maintenance-idle'
        | 'testing'
        | 'error'
      currentPractice: components['schemas']['CurrentPractice']
      submissionSummary: components['schemas']['SubmissionSummary']
      lastError: components['schemas']['DiagnosticError']
    }
    HeartbeatObservation: {
      releaseVersion: string
      /** Format: uuid */
      runtimeId: string
      runtimeGeneration: components['schemas']['PositiveInteger']
      sequence: components['schemas']['PositiveInteger']
      /** @enum {string} */
      activationState: 'active' | 'inactive'
      /** @enum {string} */
      phase:
        | 'idle'
        | 'preparing'
        | 'practicing'
        | 'saving'
        | 'maintenance-idle'
        | 'testing'
        | 'error'
      currentPractice: components['schemas']['CurrentPractice']
      submissionSummary: {
        waitingFirstUpload: components['schemas']['Count']
        unconfirmed: components['schemas']['Count']
        failed: components['schemas']['Count']
      } | null
      lastError: components['schemas']['DiagnosticError']
    } | null
    HeartbeatResponse: components['schemas']['StudentState'] & {
      heartbeatAccepted: boolean
      taskIds: string[]
    }
    EnrollmentCreate: {
      expectedModeRevision: components['schemas']['PositiveInteger']
      /** @default 600 */
      validForSeconds: number
    }
    Enrollment: {
      /** Format: uuid */
      id: string
      /** @enum {string} */
      status: 'active' | 'expired' | 'revoked'
      /** Format: date-time */
      issuedAt: string
      /** Format: date-time */
      expiresAt: string
      registeredCount: components['schemas']['Count']
    }
    EnrollmentCreated: components['schemas']['Mode'] & {
      enrollment: components['schemas']['Enrollment']
    }
    EnrollmentList: components['schemas']['Page'] & {
      items: components['schemas']['Enrollment'][]
    }
    Registration: {
      enrollmentFile: string
      deviceSecret: string
      computerName: string
      /** @enum {string} */
      platform: 'win32' | 'linux'
      releaseVersion: string
    }
    RegisteredDevice: components['schemas']['Mode'] & {
      /** Format: uuid */
      deviceId: string
      deviceNumber: string
      /** Format: date-time */
      registeredAt: string
    }
    StudentExam: {
      /** Format: uuid */
      examId: string
      packageId: string
      title: string
      archiveSha256: components['schemas']['Digest']
      archiveBytes: components['schemas']['Count']
      pageCount: components['schemas']['Count']
      resourceCount: components['schemas']['Count']
    }
    Exam: components['schemas']['StudentExam'] & {
      published: boolean
      /** Format: date-time */
      importedAt: string
      revision: components['schemas']['PositiveInteger']
    }
    ExamImport: components['schemas']['Exam'] & {
      duplicate: boolean
    }
    ExamList: components['schemas']['Page'] & {
      items: components['schemas']['Exam'][]
    }
    StudentExamList: components['schemas']['Page'] & {
      items: components['schemas']['StudentExam'][]
    }
    PracticeRequest: {
      /** Format: uuid */
      examId: string
      archiveSha256: components['schemas']['Digest']
      candidate: components['schemas']['Candidate']
    }
    PracticeGrant: {
      /** Format: uuid */
      submissionId: string
      /** Format: date-time */
      grantedAt: string
      /** Format: date-time */
      startBefore: string
      modeRevision: components['schemas']['PositiveInteger']
    }
    Receipt: {
      /** Format: uuid */
      receiptId: string
      /** Format: uuid */
      serverId: string
      /** Format: uuid */
      deviceId: string
      /** Format: uuid */
      submissionId: string
      archiveSha256: components['schemas']['Digest']
      /** Format: date-time */
      receivedAt: string
    }
    Received: {
      /** @enum {string} */
      status: 'received'
      receipt: components['schemas']['Receipt']
    }
    Deleted: {
      /** @enum {string} */
      status: 'deleted'
      receipt: components['schemas']['Receipt']
      /** Format: date-time */
      deletedAt: string
    }
    NotReceived: {
      /** @enum {string} */
      status: 'not-received'
    }
    Receiving: {
      /** @enum {string} */
      status: 'receiving'
      retryAfterSeconds: components['schemas']['PositiveInteger']
    }
    CompletedReceipt: components['schemas']['Received'] | components['schemas']['Deleted']
    ReceiptQuery:
      | components['schemas']['NotReceived']
      | components['schemas']['Receiving']
      | components['schemas']['Received']
      | components['schemas']['Deleted']
    DeviceLabels: {
      /** Format: uuid */
      id: string
      number: string
      room: components['schemas']['NullableLabel']
      seat: components['schemas']['NullableLabel']
      displayName: components['schemas']['NullableLabel']
    }
    Submission: {
      /**
       * Format: uuid
       * @description Same as submissionId in receipt.
       */
      id: string
      /** Format: uuid */
      examId: string
      packageId: string
      candidate: components['schemas']['Candidate']
      /** Format: date-time */
      submittedAt: string
      receipt: components['schemas']['Receipt']
      archiveBytes: components['schemas']['Count']
      deviceAtReceipt: components['schemas']['DeviceLabels']
      currentDevice: components['schemas']['Device']
    }
    SubmissionList: components['schemas']['Page'] & {
      items: components['schemas']['Submission'][]
    }
    SubmissionSelection: {
      submissionIds: string[]
    }
    BatchDeleteResult: {
      items: (
        | {
            /** Format: uuid */
            submissionId: string
            /** @enum {string} */
            status: 'deleted' | 'already-deleted'
          }
        | {
            /** Format: uuid */
            submissionId: string
            /** @enum {string} */
            status: 'failed'
            error: components['schemas']['ErrorBody']
          }
      )[]
    }
    /** @enum {string} */
    TaskState:
      | 'pending'
      | 'running'
      | 'cancel-requested'
      | 'succeeded'
      | 'failed'
      | 'cancelled'
      | 'expired'
    TestParameters: {
      /** @enum {string} */
      type: 'deployment-test'
      suiteId: string
      suiteVersion: string
      caseIds: string[]
      /** Format: uuid */
      testSubmissionId: string
      testExamSha256: components['schemas']['Digest']
    }
    CleanupPreviewParameters: {
      /** @enum {string} */
      type: 'history-cleanup'
      /** @enum {string} */
      phase: 'preview'
      /** Format: uuid */
      planId: string
      /** Format: date-time */
      submittedBefore: string
    }
    CleanupExecuteParameters: {
      /** @enum {string} */
      type: 'history-cleanup'
      /** @enum {string} */
      phase: 'execute'
      /** Format: uuid */
      planId: string
      /** Format: date-time */
      submittedBefore: string
      selectionDigest: components['schemas']['Digest']
    }
    TaskParameters:
      | components['schemas']['TestParameters']
      | components['schemas']['CleanupPreviewParameters']
      | components['schemas']['CleanupExecuteParameters']
    Task: {
      /** Format: uuid */
      id: string
      /** Format: uuid */
      deviceId: string
      status: components['schemas']['TaskState']
      /** Format: date-time */
      expiresAt: string
      parameters: components['schemas']['TaskParameters']
      revision: components['schemas']['PositiveInteger']
    }
    TaskList: components['schemas']['Page'] & {
      items: components['schemas']['Task'][]
    }
    TaskLease: {
      /** Format: uuid */
      taskId: string
      /** Format: uuid */
      runtimeId: string
      /** Format: uuid */
      leaseId: string
      /** Format: date-time */
      leaseExpiresAt: string
      /** Format: date-time */
      serverTime: string
      cancelRequested: boolean
      parameters: components['schemas']['TaskParameters']
    }
    CaseResult: {
      caseId: string
      /** @enum {string} */
      status: 'passed' | 'failed' | 'cancelled' | 'timed-out' | 'not-run' | 'manual-required'
      error: components['schemas']['DiagnosticError']
    }
    PreviewResult: {
      /** @enum {string} */
      kind: 'history-preview'
      selectionDigest: components['schemas']['Digest']
      selectedCount: components['schemas']['Count']
      selectedBytes: components['schemas']['Count']
    }
    CleanupResult: {
      /** @enum {string} */
      kind: 'history-execute'
      selectedCount: components['schemas']['Count']
      deletedCount: components['schemas']['Count']
      alreadyAbsentCount: components['schemas']['Count']
      skippedCount: components['schemas']['Count']
      failedCount: components['schemas']['Count']
      deletedBytes: components['schemas']['Count']
      errors: components['schemas']['DiagnosticError'][]
    }
    TestResult: {
      /** @enum {string} */
      kind: 'deployment-test'
      cases: components['schemas']['CaseResult'][]
    }
    TaskResultInput: {
      /** Format: uuid */
      leaseId: string
      /** @enum {string} */
      status: 'succeeded' | 'failed' | 'cancelled' | 'expired'
      /** Format: date-time */
      completedAt: string
      result:
        | components['schemas']['PreviewResult']
        | components['schemas']['CleanupResult']
        | components['schemas']['TestResult']
        | (never | null)
      error: components['schemas']['DiagnosticError']
    }
    TaskResult: {
      /** Format: uuid */
      taskId: string
      /** Format: uuid */
      leaseId: string
      /** Format: date-time */
      receivedAt: string
      late: boolean
    }
    TestSuite: {
      id: string
      version: string
      name: string
      cases: {
        id: string
        name: string
        requiresManualConfirmation: boolean
      }[]
    }
    TestSuiteList: components['schemas']['Page'] & {
      items: components['schemas']['TestSuite'][]
    }
    TestRunCreate: {
      suiteId: string
      caseIds: string[]
      deviceIds: components['schemas']['Ids']
      /** Format: date-time */
      expiresAt: string
      /** Format: uuid */
      retryOf?: string
    }
    ConfirmationCase: {
      caseId: string
      /** @enum {string} */
      status: 'pending' | 'passed' | 'failed'
      note: string
    }
    ConfirmationInput: {
      expectedRevision: components['schemas']['PositiveInteger']
      cases: components['schemas']['ConfirmationCase'][]
    }
    Confirmation: {
      revision: components['schemas']['PositiveInteger']
      cases: components['schemas']['ConfirmationCase'][]
      updatedAt: components['schemas']['NullableTime']
    }
    TestDeviceResult: {
      device: components['schemas']['DeviceLabels']
      task: components['schemas']['Task']
      releaseVersion: string | null
      lastHeartbeatAt: components['schemas']['NullableTime']
      cases: components['schemas']['CaseResult'][]
      confirmation: components['schemas']['Confirmation']
      /** @description Persisted task-level report, including the sanitized error submitted by the executor even when no case results were produced. Null until a report is received. */
      report: {
        /** Format: uuid */
        leaseId: string
        status: components['schemas']['TaskState']
        /** Format: date-time */
        completedAt: string
        error: components['schemas']['DiagnosticError']
      } | null
      late: boolean
    }
    TestRun: {
      /** Format: uuid */
      id: string
      suiteId: string
      suiteVersion: string
      /** Format: date-time */
      createdAt: string
      /** Format: date-time */
      expiresAt: string
      status: components['schemas']['TaskState']
      /** Format: uuid */
      retryOf: string | null
      devices: components['schemas']['TestDeviceResult'][]
    }
    TestRunList: components['schemas']['Page'] & {
      items: components['schemas']['TestRun'][]
    }
    TestReport: components['schemas']['TestRun'] & {
      /** Format: uuid */
      serverId: string
      releaseVersion: string
      /** Format: date-time */
      generatedAt: string
    }
    CleanupCreate: {
      deviceIds: components['schemas']['Ids']
      /** Format: date-time */
      submittedBefore: string
      /** Format: date-time */
      expiresAt: string
    }
    CleanupConfirm: {
      expectedRevision: components['schemas']['PositiveInteger']
      selections: {
        /** Format: uuid */
        deviceId: string
        selectionDigest: components['schemas']['Digest']
      }[]
    }
    CleanupDevice: {
      /** Format: uuid */
      deviceId: string
      /** Format: uuid */
      previewTaskId: string
      /** Format: uuid */
      executionTaskId: string | null
      status: components['schemas']['TaskState']
      selectionDigest: components['schemas']['NullableDigest']
      selectedCount: number | null
      selectedBytes: number | null
      previewedAt: components['schemas']['NullableTime']
      confirmed: boolean
      result: components['schemas']['CleanupResult'] | (never | null)
      error: components['schemas']['DiagnosticError']
    }
    CleanupPlan: {
      /** Format: uuid */
      id: string
      revision: components['schemas']['PositiveInteger']
      /** @enum {string} */
      status:
        | 'previewing'
        | 'awaiting-confirmation'
        | 'executing'
        | 'cancel-requested'
        | 'succeeded'
        | 'failed'
        | 'cancelled'
        | 'expired'
      /** Format: date-time */
      createdAt: string
      /** Format: date-time */
      submittedBefore: string
      /** Format: date-time */
      expiresAt: string
      devices: components['schemas']['CleanupDevice'][]
    }
    CleanupList: components['schemas']['Page'] & {
      items: components['schemas']['CleanupPlan'][]
    }
    StorageSummary: {
      usedBytes: components['schemas']['Count']
      freeBytes: components['schemas']['Count']
      pendingGcBytes: components['schemas']['Count']
    }
    Settings: {
      name: string
      /** Format: uri */
      baseUrl: string
      limits: components['schemas']['Limits']
      revision: components['schemas']['PositiveInteger']
      storage: components['schemas']['StorageSummary']
    }
    SettingsPatch: {
      name?: string
      /** Format: uri */
      baseUrl?: string
      limits?: components['schemas']['Limits']
      expectedRevision: components['schemas']['PositiveInteger']
    }
    LogEntry: {
      /** Format: uuid */
      id: string
      /** Format: date-time */
      at: string
      /** @enum {string} */
      level: 'debug' | 'info' | 'warn' | 'error'
      message: string
      requestId: string | null
    }
    LogList: components['schemas']['Page'] & {
      items: components['schemas']['LogEntry'][]
    }
    /** @description pending reserves maintenance; running covers both snapshot and encryption/publication. The write barrier ends after staging is durable, but claims and exit remain blocked until ready/failed. Either pending or running can fail. Restart fails unfinished jobs because passwords are memory-only; replay never restarts them. Only ready is downloadable. */
    Backup: {
      /** Format: uuid */
      id: string
      /** @enum {string} */
      status: 'pending' | 'running' | 'ready' | 'failed'
      /** Format: date-time */
      createdAt: string
      snapshotAt: components['schemas']['NullableTime']
      releaseVersion: string
      archiveBytes: number | null
      archiveSha256: components['schemas']['NullableDigest']
      error: components['schemas']['DiagnosticError']
    }
    BackupList: components['schemas']['Page'] & {
      items: components['schemas']['Backup'][]
    }
    /** @description Only known diagnostic fields; never credentials or filesystem paths. */
    ErrorDetails: {
      revision?: components['schemas']['PositiveInteger']
      modeRevision?: components['schemas']['PositiveInteger']
      /** @enum {string} */
      mode?: 'normal' | 'maintenance'
      blockers?: components['schemas']['Blocker'][]
      expectedReleaseVersion?: string
      actualReleaseVersion?: string
      field?: string
      limit?: components['schemas']['Count']
    }
    ErrorBody: {
      /** @enum {string} */
      code:
        | 'INVALID_REQUEST'
        | 'AUTH_REQUIRED'
        | 'TOKEN_EXPIRED'
        | 'TOKEN_REVOKED'
        | 'DEVICE_DISABLED'
        | 'LICENSE_INACTIVE'
        | 'ENROLLMENT_REJECTED'
        | 'NOT_FOUND'
        | 'SERVICE_MAINTENANCE'
        | 'VERSION_MISMATCH'
        | 'REVISION_CONFLICT'
        | 'CONTENT_CONFLICT'
        | 'RESOURCE_BUSY'
        | 'PAYLOAD_TOO_LARGE'
        | 'UNSUPPORTED_MEDIA_TYPE'
        | 'INVALID_EXAM'
        | 'INVALID_SUBMISSION'
        | 'RATE_LIMITED'
        | 'SERVICE_NOT_READY'
        | 'STORAGE_UNAVAILABLE'
      message: string
      requestId: string
      details?: components['schemas']['ErrorDetails']
    }
    Error: {
      error: components['schemas']['ErrorBody']
    }
  }
  responses: {
    /** @description 409 RESOURCE_BUSY for current mode, task eligibility or resource blockers; VERSION_MISMATCH, REVISION_CONFLICT and CONTENT_CONFLICT retain their normal meaning. Busy backup/task responses include details.blockers when a blocking resource exists; normal-mode rejection includes mode and modeRevision. Backup-blocked claim responses provide Retry-After; this is not authority to repeat side effects. */
    StateConflict: {
      headers: {
        'X-Request-Id'?: string
        /** @description Minimum whole seconds before retrying a backup-blocked claim. */
        'Retry-After'?: number
        [name: string]: unknown
      }
      content: {
        'application/json': components['schemas']['Error'] & {
          error?: {
            /** @enum {string} */
            code?: 'RESOURCE_BUSY' | 'VERSION_MISMATCH' | 'REVISION_CONFLICT' | 'CONTENT_CONFLICT'
          }
        }
      }
    }
    /** @description 503 SERVICE_NOT_READY during initialization or a closed backup write gate; STORAGE_UNAVAILABLE for a storage failure. Backup write rejection provides Retry-After and relevant blockers, never extends a lease, and does not prove a submission was not received. */
    ServiceUnavailable: {
      headers: {
        'X-Request-Id'?: string
        /** @description Minimum whole seconds to wait; not a lease extension. */
        'Retry-After'?: number
        [name: string]: unknown
      }
      content: {
        'application/json': components['schemas']['Error'] & {
          error?: {
            /** @enum {string} */
            code?: 'SERVICE_NOT_READY' | 'STORAGE_UNAVAILABLE'
          }
        }
      }
    }
    /** @description 400 INVALID_REQUEST; 401 AUTH_REQUIRED/TOKEN_EXPIRED/TOKEN_REVOKED; 403 DEVICE_DISABLED/LICENSE_INACTIVE/ENROLLMENT_REJECTED; 404 NOT_FOUND; 409 SERVICE_MAINTENANCE/VERSION_MISMATCH/REVISION_CONFLICT/CONTENT_CONFLICT/RESOURCE_BUSY; 413 PAYLOAD_TOO_LARGE; 415 UNSUPPORTED_MEDIA_TYPE; 422 INVALID_EXAM/INVALID_SUBMISSION; 429 RATE_LIMITED; 503 SERVICE_NOT_READY/STORAGE_UNAVAILABLE. Current authorization is checked even on replay. */
    Error: {
      headers: {
        'X-Request-Id'?: string
        /** @description Whole seconds before retry; does not imply a submission was not received. */
        'Retry-After'?: number
        [name: string]: unknown
      }
      content: {
        'application/json': components['schemas']['Error']
      }
    }
    /** @description Original complete exam archive; no range protocol. */
    ExamArchive: {
      headers: {
        'Content-Length'?: number
        'Content-Disposition'?: string
        'X-LS101-Archive-SHA256'?: components['schemas']['Digest']
        'X-Request-Id'?: string
        [name: string]: unknown
      }
      content: {
        'application/x-ls101-exam': string
      }
    }
    /** @description Original complete submission archive. */
    SubmissionArchive: {
      headers: {
        'Content-Length'?: number
        'Content-Disposition'?: string
        'X-LS101-Archive-SHA256'?: components['schemas']['Digest']
        'X-Request-Id'?: string
        [name: string]: unknown
      }
      content: {
        'application/x-ls101-submission': string
      }
    }
  }
  parameters: {
    Id: string
    ExamId: string
    SubmissionId: string
    TaskId: string
    ClientVersion: string
    /** @description Required for loopback password-free sessions; single-use proof from protected local IPC. */
    LocalAuthorization: string
    IdempotencyKey: string
    ArchiveDigest: components['schemas']['Digest']
    TaskLease: string
    Cursor: string
    Limit: number
    Query: string
    Room: string
    /** @description Inclusive timestamp; receivedAt for submissions. */
    From: string
    /** @description Exclusive timestamp; receivedAt for submissions. */
    Before: string
  }
  requestBodies: {
    ExamArchive: {
      content: {
        'application/x-ls101-exam': string
      }
    }
    SubmissionArchive: {
      content: {
        'application/x-ls101-submission': string
      }
    }
  }
  headers: never
  pathItems: never
}
export type $defs = Record<string, never>
export interface operations {
  getInfo: {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Service information */
      200: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['Info']
        }
      }
      default: components['responses']['Error']
    }
  }
  postTeacherSessions: {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
        /** @description Required for loopback password-free sessions; single-use proof from protected local IPC. */
        'X-LS101-Local-Authorization'?: components['parameters']['LocalAuthorization']
      }
      path?: never
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['SessionRequest']
      }
    }
    responses: {
      /** @description Authenticated session */
      200: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['Session']
        }
      }
      401: components['responses']['Error']
      default: components['responses']['Error']
    }
  }
  deleteTeacherSessionsCurrent: {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Revoked */
      204: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content?: never
      }
      default: components['responses']['Error']
    }
  }
  getTeacherSecurity: {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Security revision */
      200: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['Revision']
        }
      }
      default: components['responses']['Error']
    }
  }
  putTeacherSecurityPassword: {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path?: never
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['PasswordUpdate']
      }
    }
    responses: {
      /** @description Updated revision */
      200: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['Revision']
        }
      }
      409: components['responses']['Error']
      default: components['responses']['Error']
    }
  }
  getTeacherService: {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Service state */
      200: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ServiceState']
        }
      }
      default: components['responses']['Error']
    }
  }
  putTeacherServiceMode: {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path?: never
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['ModeUpdate']
      }
    }
    responses: {
      /** @description Updated mode */
      200: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['Mode']
        }
      }
      409: components['responses']['StateConflict']
      503: components['responses']['ServiceUnavailable']
      default: components['responses']['Error']
    }
  }
  getStudentState: {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Current student state */
      200: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['StudentState']
        }
      }
      default: components['responses']['Error']
    }
  }
  postStudentHeartbeat: {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path?: never
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['Heartbeat']
      }
    }
    responses: {
      /** @description Heartbeat result */
      200: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HeartbeatResponse']
        }
      }
      409: components['responses']['Error']
      default: components['responses']['Error']
    }
  }
  getTeacherDevices: {
    parameters: {
      query?: {
        cursor?: components['parameters']['Cursor']
        limit?: components['parameters']['Limit']
        room?: components['parameters']['Room']
        q?: components['parameters']['Query']
        online?: boolean
        versionMismatch?: boolean
      }
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Device list */
      200: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['DeviceList']
        }
      }
      default: components['responses']['Error']
    }
  }
  getTeacherDevicesId: {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path: {
        id: components['parameters']['Id']
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Device details */
      200: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['DeviceDetails']
        }
      }
      default: components['responses']['Error']
    }
  }
  patchTeacherDevicesId: {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path: {
        id: components['parameters']['Id']
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['DevicePatch']
      }
    }
    responses: {
      /** @description Updated device */
      200: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['Device']
        }
      }
      409: components['responses']['Error']
      default: components['responses']['Error']
    }
  }
  postTeacherDevicesIdResetBinding: {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
        'Idempotency-Key': components['parameters']['IdempotencyKey']
      }
      path: {
        id: components['parameters']['Id']
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Binding reset; device identity and history retained */
      204: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content?: never
      }
      default: components['responses']['Error']
    }
  }
  getTeacherEnrollments: {
    parameters: {
      query?: {
        cursor?: components['parameters']['Cursor']
        limit?: components['parameters']['Limit']
      }
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Enrollment batches */
      200: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['EnrollmentList']
        }
      }
      default: components['responses']['Error']
    }
  }
  postTeacherEnrollments: {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
        'Idempotency-Key': components['parameters']['IdempotencyKey']
      }
      path?: never
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['EnrollmentCreate']
      }
    }
    responses: {
      /** @description Batch created and maintenance entered */
      201: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['EnrollmentCreated']
        }
      }
      default: components['responses']['Error']
    }
  }
  deleteTeacherEnrollmentsId: {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path: {
        id: components['parameters']['Id']
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Closed without changing mode */
      204: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content?: never
      }
      default: components['responses']['Error']
    }
  }
  getTeacherEnrollmentsIdFile: {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path: {
        id: components['parameters']['Id']
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Signed enrollment JWS */
      200: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/jose': string
        }
      }
      default: components['responses']['Error']
    }
  }
  putEnrollmentDevicesInstallationId: {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path: {
        installationId: string
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['Registration']
      }
    }
    responses: {
      /** @description Existing registration */
      200: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['RegisteredDevice']
        }
      }
      /** @description Registered */
      201: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['RegisteredDevice']
        }
      }
      default: components['responses']['Error']
    }
  }
  getTeacherExams: {
    parameters: {
      query?: {
        cursor?: components['parameters']['Cursor']
        limit?: components['parameters']['Limit']
        q?: components['parameters']['Query']
        published?: boolean
      }
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Exams */
      200: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ExamList']
        }
      }
      default: components['responses']['Error']
    }
  }
  postTeacherExams: {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
        'X-LS101-Archive-SHA256': components['parameters']['ArchiveDigest']
      }
      path?: never
      cookie?: never
    }
    requestBody: components['requestBodies']['ExamArchive']
    responses: {
      /** @description Identical existing exam */
      200: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ExamImport']
        }
      }
      /** @description Imported and published */
      201: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ExamImport']
        }
      }
      default: components['responses']['Error']
    }
  }
  getTeacherExamsExamId: {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path: {
        examId: components['parameters']['ExamId']
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Exam metadata */
      200: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['Exam']
        }
      }
      default: components['responses']['Error']
    }
  }
  deleteTeacherExamsExamId: {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path: {
        examId: components['parameters']['ExamId']
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Exam deleted; grants and submissions retained */
      204: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content?: never
      }
      default: components['responses']['Error']
    }
  }
  patchTeacherExamsExamId: {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path: {
        examId: components['parameters']['ExamId']
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': {
          published: boolean
          expectedRevision: components['schemas']['PositiveInteger']
        }
      }
    }
    responses: {
      /** @description Updated exam */
      200: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['Exam']
        }
      }
      default: components['responses']['Error']
    }
  }
  getTeacherExamsExamIdArchive: {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path: {
        examId: components['parameters']['ExamId']
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      200: components['responses']['ExamArchive']
      default: components['responses']['Error']
    }
  }
  getStudentExams: {
    parameters: {
      query?: {
        cursor?: components['parameters']['Cursor']
        limit?: components['parameters']['Limit']
        q?: components['parameters']['Query']
      }
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Published exams in normal mode */
      200: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['StudentExamList']
        }
      }
      default: components['responses']['Error']
    }
  }
  getStudentExamsExamIdArchive: {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path: {
        examId: components['parameters']['ExamId']
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      200: components['responses']['ExamArchive']
      default: components['responses']['Error']
    }
  }
  putStudentPracticesSubmissionId: {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path: {
        submissionId: components['parameters']['SubmissionId']
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['PracticeRequest']
      }
    }
    responses: {
      /** @description Same unexpired grant after current authorization check */
      200: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['PracticeGrant']
        }
      }
      /** @description New start grant */
      201: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['PracticeGrant']
        }
      }
      default: components['responses']['Error']
    }
  }
  putStudentSubmissionsSubmissionId: {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
        'X-LS101-Archive-SHA256': components['parameters']['ArchiveDigest']
      }
      path: {
        submissionId: components['parameters']['SubmissionId']
      }
      cookie?: never
    }
    requestBody: components['requestBodies']['SubmissionArchive']
    responses: {
      /** @description Original receipt including deletion tombstone */
      200: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['CompletedReceipt']
        }
      }
      /** @description Durably received */
      201: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['Received']
        }
      }
      default: components['responses']['Error']
    }
  }
  getStudentSubmissionsSubmissionIdReceipt: {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path: {
        submissionId: components['parameters']['SubmissionId']
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Owned submission result; normal mode only */
      200: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ReceiptQuery']
        }
      }
      default: components['responses']['Error']
    }
  }
  getTeacherSubmissions: {
    parameters: {
      query?: {
        cursor?: components['parameters']['Cursor']
        limit?: components['parameters']['Limit']
        room?: components['parameters']['Room']
        examId?: string
        deviceId?: string
        candidateId?: string
        candidateName?: string
        /** @description Inclusive timestamp; receivedAt for submissions. */
        from?: components['parameters']['From']
        /** @description Exclusive timestamp; receivedAt for submissions. */
        before?: components['parameters']['Before']
      }
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Received submissions */
      200: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['SubmissionList']
        }
      }
      default: components['responses']['Error']
    }
  }
  getTeacherSubmissionsId: {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path: {
        id: components['parameters']['Id']
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Submission metadata */
      200: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['Submission']
        }
      }
      default: components['responses']['Error']
    }
  }
  deleteTeacherSubmissionsId: {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path: {
        id: components['parameters']['Id']
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Logically deleted; original receipt retained */
      204: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content?: never
      }
      default: components['responses']['Error']
    }
  }
  getTeacherSubmissionsIdArchive: {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path: {
        id: components['parameters']['Id']
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      200: components['responses']['SubmissionArchive']
      default: components['responses']['Error']
    }
  }
  postTeacherSubmissionsExport: {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path?: never
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['SubmissionSelection']
      }
    }
    responses: {
      /** @description Complete outer ZIP containing original submission packages */
      200: {
        headers: {
          'Content-Disposition'?: string
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/zip': string
        }
      }
      default: components['responses']['Error']
    }
  }
  postTeacherSubmissionsDelete: {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
        'Idempotency-Key': components['parameters']['IdempotencyKey']
      }
      path?: never
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['SubmissionSelection']
      }
    }
    responses: {
      /** @description Per-item outcomes for fixed selection */
      200: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['BatchDeleteResult']
        }
      }
      default: components['responses']['Error']
    }
  }
  getStudentTasks: {
    parameters: {
      query?: {
        cursor?: components['parameters']['Cursor']
        limit?: components['parameters']['Limit']
      }
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Currently claimable tasks */
      200: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['TaskList']
        }
      }
      default: components['responses']['Error']
    }
  }
  postStudentTasksIdClaim: {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path: {
        id: components['parameters']['Id']
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': {
          /** Format: uuid */
          runtimeId: string
        }
      }
    }
    responses: {
      /** @description Lease bound to this runtime */
      200: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['TaskLease']
        }
      }
      409: components['responses']['StateConflict']
      503: components['responses']['ServiceUnavailable']
      default: components['responses']['Error']
    }
  }
  putStudentTasksIdLease: {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path: {
        id: components['parameters']['Id']
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': {
          /** Format: uuid */
          runtimeId: string
          /** Format: uuid */
          leaseId: string
        }
      }
    }
    responses: {
      /** @description Renewed lease and cancellation state */
      200: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['TaskLease']
        }
      }
      409: components['responses']['StateConflict']
      503: components['responses']['ServiceUnavailable']
      default: components['responses']['Error']
    }
  }
  putStudentTasksIdResult: {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path: {
        id: components['parameters']['Id']
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['TaskResultInput']
      }
    }
    responses: {
      /** @description Immutable result receipt */
      200: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['TaskResult']
        }
      }
      default: components['responses']['Error']
    }
  }
  getTeacherTestSuites: {
    parameters: {
      query?: {
        cursor?: components['parameters']['Cursor']
        limit?: components['parameters']['Limit']
      }
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Installed suites */
      200: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['TestSuiteList']
        }
      }
      default: components['responses']['Error']
    }
  }
  getTeacherTestRuns: {
    parameters: {
      query?: {
        cursor?: components['parameters']['Cursor']
        limit?: components['parameters']['Limit']
      }
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Test runs */
      200: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['TestRunList']
        }
      }
      default: components['responses']['Error']
    }
  }
  postTeacherTestRuns: {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
        'Idempotency-Key': components['parameters']['IdempotencyKey']
      }
      path?: never
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['TestRunCreate']
      }
    }
    responses: {
      /** @description Fixed test batch */
      201: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['TestRun']
        }
      }
      default: components['responses']['Error']
    }
  }
  getTeacherTestRunsId: {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path: {
        id: components['parameters']['Id']
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Per-device details and confirmation revisions */
      200: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['TestRun']
        }
      }
      default: components['responses']['Error']
    }
  }
  postTeacherTestRunsIdCancel: {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path: {
        id: components['parameters']['Id']
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Pending tasks cancelled; running tasks stopping */
      200: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['TestRun']
        }
      }
      default: components['responses']['Error']
    }
  }
  getTeacherTestRunsIdReport: {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path: {
        id: components['parameters']['Id']
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Downloadable report */
      200: {
        headers: {
          'Content-Disposition'?: string
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['TestReport']
        }
      }
      default: components['responses']['Error']
    }
  }
  putTeacherTestRunsIdDevicesDeviceIdConfirmation: {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path: {
        id: components['parameters']['Id']
        deviceId: string
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['ConfirmationInput']
      }
    }
    responses: {
      /** @description Updated manual confirmation */
      200: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['Confirmation']
        }
      }
      default: components['responses']['Error']
    }
  }
  getStudentTasksTaskIdTestExam: {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
        'X-LS101-Task-Lease': components['parameters']['TaskLease']
      }
      path: {
        taskId: components['parameters']['TaskId']
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      200: components['responses']['ExamArchive']
      default: components['responses']['Error']
    }
  }
  putStudentTasksTaskIdTestSubmission: {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
        'X-LS101-Task-Lease': components['parameters']['TaskLease']
        'X-LS101-Archive-SHA256': components['parameters']['ArchiveDigest']
      }
      path: {
        taskId: components['parameters']['TaskId']
      }
      cookie?: never
    }
    requestBody: components['requestBodies']['SubmissionArchive']
    responses: {
      /** @description Same test receipt */
      200: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['Received']
        }
      }
      /** @description Isolated test submission received */
      201: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['Received']
        }
      }
      default: components['responses']['Error']
    }
  }
  getStudentTasksTaskIdTestReceipt: {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
        'X-LS101-Task-Lease': components['parameters']['TaskLease']
      }
      path: {
        taskId: components['parameters']['TaskId']
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Result within active test lease */
      200: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json':
            | components['schemas']['NotReceived']
            | components['schemas']['Receiving']
            | components['schemas']['Received']
        }
      }
      default: components['responses']['Error']
    }
  }
  getTeacherHistoryCleanups: {
    parameters: {
      query?: {
        cursor?: components['parameters']['Cursor']
        limit?: components['parameters']['Limit']
      }
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Cleanup plans */
      200: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['CleanupList']
        }
      }
      default: components['responses']['Error']
    }
  }
  postTeacherHistoryCleanups: {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
        'Idempotency-Key': components['parameters']['IdempotencyKey']
      }
      path?: never
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['CleanupCreate']
      }
    }
    responses: {
      /** @description Read-only preview scheduled */
      201: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['CleanupPlan']
        }
      }
      default: components['responses']['Error']
    }
  }
  getTeacherHistoryCleanupsId: {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path: {
        id: components['parameters']['Id']
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Current previews, revision and execution results */
      200: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['CleanupPlan']
        }
      }
      default: components['responses']['Error']
    }
  }
  postTeacherHistoryCleanupsIdConfirm: {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path: {
        id: components['parameters']['Id']
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['CleanupConfirm']
      }
    }
    responses: {
      /** @description Selected snapshots frozen for execution */
      200: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['CleanupPlan']
        }
      }
      default: components['responses']['Error']
    }
  }
  postTeacherHistoryCleanupsIdCancel: {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path: {
        id: components['parameters']['Id']
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Cancellation requested without undoing completed deletions */
      200: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['CleanupPlan']
        }
      }
      default: components['responses']['Error']
    }
  }
  getTeacherSettings: {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Hot settings and independent revision */
      200: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['Settings']
        }
      }
      default: components['responses']['Error']
    }
  }
  patchTeacherSettings: {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path?: never
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['SettingsPatch']
      }
    }
    responses: {
      /** @description Updated settings */
      200: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['Settings']
        }
      }
      default: components['responses']['Error']
    }
  }
  getTeacherLogs: {
    parameters: {
      query?: {
        cursor?: components['parameters']['Cursor']
        limit?: components['parameters']['Limit']
        /** @description Inclusive timestamp; receivedAt for submissions. */
        from?: components['parameters']['From']
        /** @description Exclusive timestamp; receivedAt for submissions. */
        before?: components['parameters']['Before']
        level?: 'debug' | 'info' | 'warn' | 'error'
        requestId?: string
      }
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Redacted logs */
      200: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['LogList']
        }
      }
      default: components['responses']['Error']
    }
  }
  getTeacherBackups: {
    parameters: {
      query?: {
        cursor?: components['parameters']['Cursor']
        limit?: components['parameters']['Limit']
      }
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Backup jobs */
      200: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['BackupList']
        }
      }
      default: components['responses']['Error']
    }
  }
  postTeacherBackups: {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
        'Idempotency-Key': components['parameters']['IdempotencyKey']
      }
      path?: never
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': {
          encryptionPassword: string
        }
      }
    }
    responses: {
      /** @description Backup queued */
      202: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['Backup']
        }
      }
      409: components['responses']['StateConflict']
      503: components['responses']['ServiceUnavailable']
      default: components['responses']['Error']
    }
  }
  getTeacherBackupsId: {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path: {
        id: components['parameters']['Id']
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Backup state */
      200: {
        headers: {
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['Backup']
        }
      }
      default: components['responses']['Error']
    }
  }
  getTeacherBackupsIdArchive: {
    parameters: {
      query?: never
      header: {
        'X-LS101-Client-Version': components['parameters']['ClientVersion']
      }
      path: {
        id: components['parameters']['Id']
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Completed encrypted backup */
      200: {
        headers: {
          'Content-Length'?: number
          'Content-Disposition'?: string
          'X-LS101-Archive-SHA256'?: components['schemas']['Digest']
          'X-Request-Id'?: string
          [name: string]: unknown
        }
        content: {
          'application/x-7z-compressed': string
        }
      }
      409: components['responses']['StateConflict']
      default: components['responses']['Error']
    }
  }
}
