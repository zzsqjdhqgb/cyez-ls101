// @ls101/core-types — Interface 相关跨模块类型
//
// Interface 模块向 Template 模块和评分系统暴露的数据契约。

/**
 * Interface 中一个变量的元信息。
 * Template 编辑器的变量选择器使用此类型展示可用变量。
 */
export interface InterfaceVarInfo {
  /** 变量名，在 Template 中以 [@varName] 引用 */
  varName: string

  /** 变量类型：文本或图片 */
  type: 'text' | 'image'

  /** 字段描述（来自 InterfaceDef 中对应 FieldLeaf.description） */
  description: string

  /** 示例值（来自 InterfaceDef 中对应 FieldLeaf.example） */
  example: string

  /** 字段在 Interface fields 树中的完整路径，以 "." 分隔，如 "sectionA.sentences.s1" */
  path: string
}

/**
 * Interface 变量清单。Template 编辑器导入此结构来构建变量选择器。
 * 即使尚未调用 AI 生成实例，变量名列表已可用——教师可以先编辑 Template 后生成数据。
 */
export interface InterfaceVarManifest {
  /** 来源 Interface 定义 ID */
  interfaceId: string

  /** 来源 Interface 名称 */
  interfaceName: string

  /** 该 Interface 导出的所有变量 */
  vars: InterfaceVarInfo[]
}

/**
 * Interface 实例——AI 生成完成后的一整套数据。
 * Template 编辑器中选定一个实例后，所有 varName → value 的映射注入为全局变量池。
 * Template 中的 [@varName] 引用解析时查此 values 表。
 */
export interface InterfaceInstance {
  /** 实例唯一标识 */
  instanceId: string

  /** 用户可编辑的实例名称，不参与 AI 或 JSON 生成 */
  name: string

  /** 生成时间（ISO 8601） */
  generatedAt: string

  /**
   * 变量名到值的映射。
   * 值始终为字符串；对于 image 类型字段，值为图片 Asset 文件名或空字符串。
   */
  values: Record<string, string>

  /** Interface Editor 保存的图片提示词中间值；下游模块不将其作为变量值使用。 */
  imagePrompts?: Record<string, string>
}
