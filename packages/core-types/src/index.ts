// @ls101/core-types — 全项目共享的基础类型定义
//
// 本模块只包含被多个包引用的跨模块契约类型。
// 按领域拆分为独立文件，index.ts 仅做 re-export。
// 各包内部的领域类型（InterfaceDef、SectionDef 等）定义在各自的包中。

export type { InterfaceVarInfo, InterfaceVarManifest, InterfaceInstance } from './interface'
