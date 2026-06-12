<!--
 Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 Proprietary code. Use is subject to the LICENSE file in the repository root.
-->

// !!IMPORTANT: AI assistants should not read any thing in this file, because they are only rought ideas, and should not be implemented or considered.

- [x] 考试页面content高度溢出
- [ ] 图标没有抗锯齿
- [ ] 时间戳应该包含分钟和秒数，我喜欢没有连接符的那种，例如202601011501
- [ ] markdown列表显示不好看，列表符号应该和行首对齐
- [x] ~~实现一个纯文本逻辑的处理，将markdown解析为ast，然后替换所有media链接为base64，然后再重新转换为markdown。在导出pdf和批改页面，后端都直接使用转换好的markdown渲染或者发送到前端~~
- [x] 全软件禁止使用alert，最好能通过什么办法实现只要引入alert就报错
- [ ] 美化导出pdf
- [ ] ~~pdf和软件内使用统一的渲染引擎~~
- [x] 使用自定义后缀名和图标
- [ ] 参考答案列表显示异常
- [x] 批改时不自动播放，或者只自动播放第一个
- [x] 分数允许多位小数，而不是自动四舍五入
- [ ] stt有问题，应该是vad的锅，之后得想办法解决
- [x] 分数统计有问题，应当自动把最高可选分数作为fullscore
- [x] 四宫格图片显示有问题