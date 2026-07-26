import { describe, it, expect } from "vitest"
import { validateInterfaceDef } from "../validation"
import type { InterfaceDef, FieldNode } from "../types"

// ============================================================
// 测试辅助
// ============================================================

function textLeaf(varName: string, description = "desc", example = "ex") {
  return { type: "text" as const, varName, description, example }
}

function group(children: Record<string, FieldNode>) {
  return { type: "group" as const, children }
}

function validDef(overrides: Partial<InterfaceDef> = {}): InterfaceDef {
  return {
    id: "test-id",
    name: "Test Interface",
    description: "A test interface",
    promptTemplate: "Generate a test exam",
    fields: {
      s1: textLeaf("question1"),
    },
    ...overrides,
  }
}

// ============================================================
// 正常情况
// ============================================================

describe("validateInterfaceDef — 正常", () => {
  it("合法的 InterfaceDef 返回 valid=true 无错误", () => {
    const result = validateInterfaceDef(validDef())
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it("多层嵌套的合法结构通过校验", () => {
    const result = validateInterfaceDef(
      validDef({
        fields: {
          sectionA: group({
            inner: textLeaf("a1"),
          }),
          sectionB: group({
            sub: group({
              deep: textLeaf("b1"),
            }),
          }),
        },
      })
    )
    expect(result.valid).toBe(true)
  })

  it("image 类型叶子合法", () => {
    const result = validateInterfaceDef(
      validDef({
        fields: {
          img: {
            type: "image",
            varName: "pic1",
            description: "A picture",
            example: "A cat",
          },
        },
      })
    )
    expect(result.valid).toBe(true)
  })
})

// ============================================================
// 顶层校验
// ============================================================

describe("validateInterfaceDef — 顶层校验", () => {
  it("promptTemplate 为空字符串 → 报错 path=''", () => {
    const result = validateInterfaceDef(validDef({ promptTemplate: "" }))
    expect(result.valid).toBe(false)
    expect(result.errors).toContainEqual({
      path: "",
      message: expect.stringContaining("提示词模板") as unknown as string,
    })
  })

  it("promptTemplate 仅空白 → 报错", () => {
    const result = validateInterfaceDef(validDef({ promptTemplate: "   " }))
    expect(result.valid).toBe(false)
    expect(result.errors).toContainEqual({
      path: "",
      message: expect.stringContaining("提示词模板") as unknown as string,
    })
  })

  it("fields 为空 → 报错", () => {
    const result = validateInterfaceDef(validDef({ fields: {} }))
    expect(result.valid).toBe(false)
    expect(result.errors).toContainEqual({
      path: "",
      message: expect.stringContaining("字段结构不能为空") as unknown as string,
    })
  })
})

// ============================================================
// 字段组校验
// ============================================================

describe("validateInterfaceDef — 字段组校验", () => {
  it("FieldGroup.children 为空 → 报错", () => {
    const result = validateInterfaceDef(
      validDef({
        fields: { emptyGroup: group({}) },
      })
    )
    expect(result.valid).toBe(false)
    expect(result.errors).toContainEqual({
      path: "emptyGroup",
      message: expect.stringContaining("字段组不能为空") as unknown as string,
    })
  })

  it("嵌套的空字段组 → 报错路径正确", () => {
    const result = validateInterfaceDef(
      validDef({
        fields: {
          outer: group({
            inner: group({}),
          }),
        },
      })
    )
    expect(result.errors).toContainEqual({
      path: "outer.inner",
      message: expect.stringContaining("字段组不能为空") as unknown as string,
    })
  })
})

// ============================================================
// varName 校验
// ============================================================

describe("validateInterfaceDef — varName 校验", () => {
  it("varName 为空字符串 → 报错", () => {
    const result = validateInterfaceDef(
      validDef({
        fields: { a: textLeaf("") },
      })
    )
    expect(result.valid).toBe(false)
    expect(result.errors).toContainEqual({
      path: "a",
      message: expect.stringContaining("变量名不能为空") as unknown as string,
    })
  })

  it("varName 仅空白 → 报错", () => {
    const result = validateInterfaceDef(
      validDef({
        fields: { a: textLeaf("  ") },
      })
    )
    expect(result.errors).toContainEqual({
      path: "a",
      message: expect.stringContaining("变量名不能为空") as unknown as string,
    })
  })

  it("varName 含空格 → 格式报错", () => {
    const result = validateInterfaceDef(
      validDef({
        fields: { a: textLeaf("my var") },
      })
    )
    expect(result.errors).toContainEqual({
      path: "a",
      message: expect.stringContaining("格式无效") as unknown as string,
    })
  })

  it("varName 含特殊字符 → 格式报错", () => {
    const result = validateInterfaceDef(
      validDef({
        fields: { a: textLeaf("var@name") },
      })
    )
    expect(result.errors).toContainEqual({
      path: "a",
      message: expect.stringContaining("格式无效") as unknown as string,
    })
  })

  it("varName 以数字开头 → 格式报错", () => {
    const result = validateInterfaceDef(
      validDef({
        fields: { a: textLeaf("1var") },
      })
    )
    expect(result.errors).toContainEqual({
      path: "a",
      message: expect.stringContaining("格式无效") as unknown as string,
    })
  })

  it("varName 合法格式：字母开头 + 连字符 + 下划线", () => {
    const result = validateInterfaceDef(
      validDef({
        fields: { a: textLeaf("my_var-name2") },
      })
    )
    expect(result.valid).toBe(true)
  })

  it("varName 以下划线开头", () => {
    const result = validateInterfaceDef(
      validDef({
        fields: { a: textLeaf("_private") },
      })
    )
    expect(result.valid).toBe(true)
  })
})

// ============================================================
// varName 唯一性
// ============================================================

describe("validateInterfaceDef — varName 唯一性", () => {
  it("同层重复 varName → 报错", () => {
    const result = validateInterfaceDef(
      validDef({
        fields: {
          a: textLeaf("dup"),
          b: textLeaf("dup"),
        },
      })
    )
    expect(result.valid).toBe(false)
    expect(result.errors).toContainEqual({
      path: expect.any(String) as unknown as string,
      message: expect.stringContaining("dup") as unknown as string,
    })
  })

  it("跨层重复 varName → 报错", () => {
    const result = validateInterfaceDef(
      validDef({
        fields: {
          top: textLeaf("dup"),
          grp: group({
            inner: textLeaf("dup"),
          }),
        },
      })
    )
    expect(result.valid).toBe(false)
    // 第二个出现的 varName 应被标记
    expect(result.errors.some((e) => e.path === "grp.inner")).toBe(true)
  })

  it("全部 varName 唯一 → 通过", () => {
    const result = validateInterfaceDef(
      validDef({
        fields: {
          a: textLeaf("v1"),
          b: textLeaf("v2"),
          c: textLeaf("v3"),
        },
      })
    )
    expect(result.valid).toBe(true)
  })
})

// ============================================================
// description / example 非空
// ============================================================

describe("validateInterfaceDef — description / example", () => {
  it("description 为空 → 报错", () => {
    const result = validateInterfaceDef(
      validDef({
        fields: { a: textLeaf("ok", "") },
      })
    )
    expect(result.errors).toContainEqual({
      path: "a",
      message: expect.stringContaining("字段描述不能为空") as unknown as string,
    })
  })

  it("example 为空 → 报错", () => {
    const result = validateInterfaceDef(
      validDef({
        fields: { a: textLeaf("ok", "desc", "") },
      })
    )
    expect(result.errors).toContainEqual({
      path: "a",
      message: expect.stringContaining("示例值不能为空") as unknown as string,
    })
  })
})

// ============================================================
// 多重错误聚合
// ============================================================

describe("validateInterfaceDef — 多重错误聚合", () => {
  it("同时存在多个错误时全部收集", () => {
    const result = validateInterfaceDef(
      validDef({
        promptTemplate: "",
        fields: {
          a: textLeaf(""),       // 空 varName
          b: textLeaf("dup"),    // 重复
          c: textLeaf("dup"),    // 重复
        },
      })
    )
    expect(result.valid).toBe(false)
    // promptTemplate(1) + a(1: 空varName) + c(1: dup重复, b是首次出现不报) = 3
    expect(result.errors.length).toBe(3)
  })
})