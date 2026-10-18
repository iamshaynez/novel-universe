# ch1-opening
@bg rooftop time=dusk
@bgm rooftop

// 剧本 DSL 速查：
//   # scene-id            场景标签（跳转目标，全局唯一）
//   @bg <地点> k=v        背景（地点须在 universe/locations 注册）
//   @show <角色> <表情>   登场立绘 / @hide 清场
//   @bgm <曲目>           配乐（assets/scores/<曲目>.mjs）
//   @fact <事件id>        触碰正典事件（须在 universe/timeline 注册）
//   名字：「台词」         有主台词；无前缀为旁白
//   * 选项 -> scene-id [if flag]   选项行，连续 * 行合并为一个选择点
//   -> scene-id           无条件跳转
//   == ending END_ID 标题  结局（终端节点）

这里是故事开始的地方。
角色名：「像这样说话。」

* 第一个选项。 -> ch1-a
* 第二个选项。 -> ch1-b

# ch1-a
你选择了 A。
== ending END_A A 线结局

# ch1-b
你选择了 B。
== ending END_B B 线结局
