// @ls101/interface-editor — Interface 领域类型
//
// Interface 是 AI 生成试卷内容的核心抽象。教师定义一个 Interface，
// 包含提示词模板和字段结构，调用 AI 生成结构化数据实例。
// 生成的实例在 Template 编辑器中以全局变量形式被引用（[@varName]）。
//
// 字段结构：一棵嵌套的对象树。叶子字段有两类——text 和 image。
// 每个叶子字段定义了变量名（varName）、字段描述（description）和示例值（example）。
// AI 收到 description + example 作为生成依据，返回与字段结构匹配的 JSON。

// ============================================================
// 字段树节点
// ============================================================

/**
 * 叶子字段：Interface 字段树的末端节点。
 * 每个叶子字段对应 Template 中可引用的一个变量。
 */
export interface FieldLeaf {
  /** 字段值类型 */
  type: 'text' | 'image'

  /**
   * 变量名。在 Template 编辑器中以 [@varName] 语法引用。
   * 在整个 Interface 的 fields 树中必须唯一。
   */
  varName: string

  /**
   * 字段描述。告诉 AI 此字段应包含什么内容。
   * 例如 "朗读句子第一题题干" 或 "看图说话题目配图"。
   * 此文本会随 promptTemplate 一同发送给 LLM。
   */
  description: string

  /**
   * 示例值。辅助 AI 理解期望的输出格式和风格。
   * 例如 "Good morning, everyone. Welcome to our school."
   * 对于 image 类型，示例值应描述期望的图片内容（文本形式），
   * 用于生成生图提示词。
   */
  example: string
}

/**
 * 字段组：Interface 字段树的中间节点，包含若干子字段。
 * 用于将相关字段组织在一起（如将同一 Section 的所有字段放在一个组下）。
 */
export interface FieldGroup {
  type: 'group'

  /**
   * 子字段集合。key 为字段标识符（在父级组内唯一），
   * value 可以是叶子字段或嵌套的字段组。
   *
   * 教师通过编辑器自由组织层级，点击"+"按钮添加子字段。
   */
  children: Record<string, FieldNode>
}

/** 字段树节点：叶子字段或字段组 */
export type FieldNode = FieldLeaf | FieldGroup

// ============================================================
// Interface 定义
// ============================================================

/**
 * Interface 定义。一个 Interface 代表一类考试题型（如"上海高考听说"），
 * 定义了提示词模板和字段结构。教师可在 Interface 管理界面中：
 * 1. 编辑 promptTemplate（提示词）
 * 2. 编辑 fields（字段树）
 * 3. 多次调用 AI 生成多套数据实例（InterfaceInstance）
 */
export interface InterfaceContent {
  /** 显示名称，如 "上海高考口语" */
  name: string

  /** 简短描述，说明此 Interface 的用途 */
  description: string

  /**
   * AI 提示词模板。发送给 LLM 的完整 prompt。
   * 系统会将 fields 的 JSON 描述（type + description + example）拼接到 prompt 后一同发送。
   * varName 不发送给 LLM——LLM 看到的是字段结构和描述，不是变量名。
   */
  promptTemplate: string

  /**
   * 字段结构树。定义了 AI 输出 JSON 的结构和每个字段的含义。
   * 树的叶子节点对应 Template 中可用的变量。
   */
  fields: Record<string, FieldNode>
}

/** 可编辑草稿。draftId 只标识本机编辑会话，不参与导入导出。 */
export interface InterfaceDraft extends InterfaceContent {
  draftId: string
}

/** 已发布或导入的 Interface；id 由完整内容确定。 */
export interface InterfaceDef extends InterfaceContent {
  /** sha256:<64 位十六进制摘要> */
  id: string
}
