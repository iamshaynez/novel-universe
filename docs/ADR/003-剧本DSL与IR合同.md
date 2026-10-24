# ADR-003 剧本 DSL 与 IR 合同

日期：2026-10-18　状态：已接受（语法部分被 [ADR-004](004-演出层转向文字舞台.md) 修订：`@show`/`@hide`/`@bgm` 已随立绘与乐谱体系移除；view 收敛为 `{bg}`；角色以台词登场；2026-10-24 增补 `@peak` 峰值指令，见 ADR-004 修订记录）

## 决策
剧本用 Markdown 风格 DSL（给人和 LLM 写），编译成 JSON IR（给引擎吃）。

## 语法（v0）
```
# scene-id                     场景标签（全局唯一，跳转目标）
@bg <地点> [k=v ...]           背景
@fact <事件id>                 触碰正典事件 → 置 flag fact.<id>
@set <flag名>                  置任意 flag（如剧情门禁 can_indict）
@transcribe <id> caller=<呼入方> target=<留言>
                               转写停点（接线员原语，提交语义）
@peak <kind> [args]            峰值拍标记（舞台合同 v1）：折叠到下一停点，
                               kind 词表与预算归 content-lint，编译器保结构与落点
名字：「台词」                   有主台词；无前缀为旁白
* 选项 -> scene [if flag]      选项行（连续 * 行合并为一个选择点）
-> scene                       无条件跳转
== ending END_ID 标题           结局（终端节点）
// 注释
```

## 编译语义
- 指令折送到下一个「停点」（台词/选项/转写/结局）的视图；视图沿阅读顺序**绝对化**（aview），
  读档可幂等重渲染。合流点的视图取阅读顺序后写者（v0 约定，ADR 可修订）。
- `@peak` 折送到下一停点的 `node.peak = {kind, args}`；**只能落在台词/转写/选项停点**
  （jump/ending 是过渡节点，落其上等于静默丢失 → 编译错误）；章尾悬空 → 编译错误；
  引擎 stateOf 纯透传（`peak` 字段），演出词汇归 web。
- 章节末尾线性节点自动续接下一章入口。
- 选择点后禁止线性落穿；目标未定义、标签重复、结局未登记 → 编译错误。

## IR 节点类型
line / choice / transcribe / jump / ending；enter 指令集：flag、affinity。
选项守卫 when=flag，隐藏选项不可 choose（引擎抛错）。
transcribe 节点附 caller/callerChar（呼入者正典绑定，声纹法证数据源）。
