export interface ReleaseNoteGroup {
  title: string
  items: readonly string[]
}

export interface ReleaseNoteSection {
  title: string
  groups: readonly ReleaseNoteGroup[]
}

export interface BuiltinSummary {
  kind: string
  count: number
  description: string
}

export const currentRelease = {
  version: '0.4.0',
  previousVersion: '0.3.2',
  date: '2026 年 8 月',
  title: '曹二听说101 v0.4.0',
  summary:
    '0.4.0 重新构建了从内容准备、试卷生成、考试运行到评分结算的完整工作流。这是一次系统性更新，不只是界面调整。',
  highlights: [
    '全新的工作台、导航和统一编辑体验',
    '完整的题型、题组、评分单元和试卷模板体系',
    '新的试卷生成、考试运行和作答包流程',
    '人工评分、AI 评分、批量结算与报告查看'
  ],
  sections: [
    {
      title: '内容准备',
      groups: [
        {
          title: '题型与题组',
          items: [
            '创建和维护题型草稿，并将其发布为稳定、不可直接修改的题型。',
            '手工创建、编辑和保存可以重复使用的题组。',
            '使用 AI 生成整组内容，或从 JSON 校验并覆盖题组。',
            '为图片字段选择文件、读取剪贴板或调用图像生成服务。',
            '导入和导出 .lsinterface 题型包，并选择需要交换的题组。',
            '识别已经存在的题组和身份冲突，避免覆盖本地内容。'
          ]
        },
        {
          title: '评分单元',
          items: [
            '定义客观题、固定朗读和录音回答等答案结构。',
            '配置模板输入、满分、参考答案、评分标准和附加提示。',
            '内置评分单元保持只读，需要调整时可以复制为用户版本。',
            '支持导入和导出 .lsschema 评分单元文件。'
          ]
        }
      ]
    },
    {
      title: '试卷模板与生成',
      groups: [
        {
          title: '模板编辑',
          items: [
            '图形化编辑页面结构、文字、图片和选择题视图。',
            '配置倒计时、播放、语音合成和录音时间线。',
            '通过函数库复用页面、题型和大题组结构。',
            '绑定题型、题组和评分单元，并在生成前定位不兼容引用。',
            '支持模板预览、标签筛选、复制、导入和导出。'
          ]
        },
        {
          title: '生成试卷',
          items: [
            '为默认、男声和女声分别选择 TTS Provider、模型和音色。',
            '逐项展示内容准备、语音合成、资源整理和打包进度。',
            '语音合成失败后保留已经完成的结果，并从失败位置重试。',
            '将生成结果加入试卷库，或导出为自包含的 .lsexam 文件。'
          ]
        }
      ]
    },
    {
      title: '考试与作答',
      groups: [
        {
          title: '运行考试',
          items: [
            '从试卷库导入、运行、导出和管理可运行试卷。',
            '考试开始前登记姓名与考生号。',
            '试卷包含录音任务时执行麦克风试录和回放检查。',
            '按时间线播放文字、图片、音频和选择题内容。',
            '支持倒计时、自动录音、录音提示音，以及播放或录音失败后的当前步骤重试。',
            '保存包含身份、答案、录音和评分上下文的 .lssubmission 作答包。'
          ]
        }
      ]
    },
    {
      title: '评分与结算',
      groups: [
        {
          title: '处理作答',
          items: [
            '分别管理未结算和已结算作答，并支持批量选择。',
            '客观题由系统自动判定，主观题可以逐项人工评分。',
            '使用语音识别和文本模型完成整场 AI 评分。',
            'AI 评分完成后可以全部采用、全部审查，或按总数和题型抽查。',
            '评分进度可以暂存，失败题目可以单独重试。',
            '将已经完成评分的作答结算为批次，并查看 Markdown 评分报告。',
            '支持对指定作答重新评分，同时保留不可修改的原始作答。'
          ]
        }
      ]
    },
    {
      title: 'AI 与语音能力',
      groups: [
        {
          title: '统一的 AI 引擎设置',
          items: [
            '集中管理文本生成、图像生成、语音合成、语音识别和 AI 语音评测。',
            '支持 OpenAI Compatible、Anthropic 和多个常用 Provider 预设。',
            '内置 Pocket TTS 离线语音合成，并可安装 Qwen3-TTS 0.6B 模型包。',
            '支持 Qwen3 ASR 本地识别模型和 OpenAI Compatible 在线识别服务。',
            '发音评测通过独立扩展包安装，不与应用主体强制绑定。',
            '支持连接测试、模型发现、模型启停和手工模型配置。',
            'API 密钥与普通配置分开加密保存。'
          ]
        }
      ]
    },
    {
      title: '应用与数据',
      groups: [
        {
          title: '桌面体验与可靠性',
          items: [
            '全新的工作台汇总试卷、待评分作答、题型、模板和评分单元。',
            '提供浅色、深色和跟随系统主题，并支持减少动态效果。',
            '业务数据可以迁移到自定义目录，也可以恢复默认位置。',
            '数据目录迁移采用可恢复流程，切换完成后再由用户确认清理旧目录。',
            '新增邀请码激活、取消激活和激活方式意见入口。',
            '使用 Electron sandbox、context isolation 和受限 preload bridge 隔离系统能力。',
            '统一记录应用错误和关键运行上下文，便于诊断故障。'
          ]
        }
      ]
    }
  ] satisfies readonly ReleaseNoteSection[],
  builtins: [
    {
      kind: '内置题型',
      count: 3,
      description: '上海高考听力、上海高考口语、上海中考口语'
    },
    {
      kind: '内置模板',
      count: 12,
      description: '高中听力与口语全卷、分块练习、中考口语全卷'
    },
    {
      kind: '内置评分单元',
      count: 14,
      description: '高考听力与口语、以及中考口语评分单元'
    },
    {
      kind: '内置函数库',
      count: 7,
      description: '基础组件、高中和初中题型与题组组件'
    }
  ] satisfies readonly BuiltinSummary[],
  upgradeNotes: [
    '0.4.0 使用新的领域模型、数据仓储和交换格式，不兼容 0.3.x 的应用数据目录。',
    '旧版 .cyexam、.cytmpl、.cydraft、.cysubm 和 .cygrade 文件不能直接作为 0.4.0 文件导入。',
    '升级或试用前请备份原数据；0.4.0 使用 .lsexam、.lsinterface、.lstemplate、.lsfunclib、.lsschema 和 .lssubmission。',
    'Qwen3-TTS 当前使用 CPU 后端，CUDA 后端暂未随本版本启用。'
  ],
  limitations: [
    '试卷生成任务仅在当前生成页面运行，不能转入后台。',
    '正式考试开始后不能暂停、返回上一步或跳过当前步骤。',
    'AI 评分中的自然语言语音纠错目前仍是占位结果。',
    'AI 评分不会把静态图片二进制直接发送给文本模型。',
    '重新评分会删除旧评分结果，当前版本不保留评分历史。',
    '内置模板、内置评分单元和已发布题型保持只读，需要复制后修改。'
  ],
  compareUrl: 'https://github.com/zzsqjdhqgb/cyez-ls101/compare/v0.3.2...v0.4.0'
} as const
