export interface ProductGuideChapter {
  slug: string
  title: string
  order: number
  goal: string
  why: string
  inputs: readonly string[]
  outputs: readonly string[]
  next: string
  unverifiedActions: readonly string[]
}

export const PRODUCT_GUIDE_CHAPTERS = [
  {
    slug: 'understand-ls101',
    title: '认识 LS101 与完整工作流',
    order: 10,
    goal: '理解 LS101 管理哪些对象，以及一次英语听说考试从内容准备到成绩产出的完整路径。',
    why: '先理解对象之间的关系，才能判断应该在哪个模块完成当前任务，避免把模板、试卷和作答记录混为一谈。',
    inputs: ['一个需要制作、运行并评分的英语听说考试任务。'],
    outputs: ['明确下一步要创建或维护的对象，以及可以从工作台或一级导航进入的功能。'],
    next: '准备评分标准、题型内容和必要的 AI 能力。',
    unverifiedActions: ['从工作台的快捷入口进入制卷、运行试卷和处理作答记录。']
  },
  {
    slug: 'prepare-content',
    title: '准备评分标准与题型内容',
    order: 20,
    goal: '先建立稳定的评分单元和题型契约，再准备可被试卷模板复用的具体题组。',
    why: '评分单元决定收集什么答案以及如何给分，题型决定内容字段，题组则提供每次制卷所用的实际材料。',
    inputs: ['考试的题目类型、答案形式、满分和评分标准。', '用于出题的文字、图片和参考答案。'],
    outputs: ['已发布的评分单元。', '已发布的题型及其一个或多个可用题组。'],
    next: '在试卷模板中引用这些稳定对象并组织考试流程。',
    unverifiedActions: [
      '将已发布评分单元真正绑定到试卷模板并在生成前校验引用。',
      '配置文本、图像或语音 AI Provider。',
      '导入、导出和删除题型或评分单元。'
    ]
  },
  {
    slug: 'build-generate-exam',
    title: '制作模板并生成试卷',
    order: 30,
    goal: '把题型、题组、评分单元、页面内容和时间线组织为可复用模板，并生成不可编辑的运行试卷。',
    why: '模板是可维护的生产规则，试卷是某次运行所需的完整快照。两者分离后，既能重复制卷，也能保证已经运行的试卷不被后续编辑改变。',
    inputs: ['已发布的题型与题组。', '已发布的评分单元。', '页面、时间线和语音合成配置。'],
    outputs: ['保存的试卷模板。', '加入试卷库或导出为文件的自包含试卷。'],
    next: '从试卷库启动生成后的试卷。',
    unverifiedActions: [
      '在模板编辑器中新增页面、题型调用、评分单元和时间线。',
      '在生成设置中为每个题型选择题组。'
    ]
  },
  {
    slug: 'run-exam',
    title: '运行试卷并保存作答包',
    order: 40,
    goal: '从试卷库启动考试，完成身份登记、播放、作答采集和作答包保存。',
    why: '试卷运行负责按模板确定的顺序采集事实数据；评分发生在运行完成之后，不应反向修改原始作答。',
    inputs: ['试卷库中的可运行试卷。', '作答人姓名和考生号。', '可用的扬声器和麦克风。'],
    outputs: ['包含身份、答案、录音和评分上下文的自包含作答包。'],
    next: '把作答包导入作答记录，开始评分和结算。',
    unverifiedActions: [
      '导入、删除和重新导入试卷。',
      '完成包含选择题、录音和时间线的完整考试。',
      '在异常退出后恢复或重新开始考试。'
    ]
  },
  {
    slug: 'grade-settle',
    title: '评分、结算与查看结果',
    order: 50,
    goal: '导入一份或多份作答，完成客观题自动判定和主观题评分，再按批次确认最终结果。',
    why: '评分进度可以暂存，而结算是对结果的最终确认。将两者分开，用户可以分批工作，并清楚地区分过程状态和正式结果。',
    inputs: ['一份或多份作答包。', '人工评分判断，或已配置的 AI 评分模型。'],
    outputs: ['已结算批次、每份作答的总分和评分报告。'],
    next: '查看或导出结果；需要修正时，对指定作答重新评分。',
    unverifiedActions: [
      '使用 AI 完成主观题批量评分。',
      '查看完整评分报告。',
      '导出作答包和结算批次成绩表。',
      '删除未结算或已结算作答。'
    ]
  }
] as const satisfies readonly ProductGuideChapter[]

export function productGuideChapter(slug: string): ProductGuideChapter | undefined {
  return PRODUCT_GUIDE_CHAPTERS.find((chapter) => chapter.slug === slug)
}
