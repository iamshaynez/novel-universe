# g03《借刀》线索系统设计（Clues）

```yaml
- id: clue-blood-card
  object: 染血的四川省无偿献血证
  obtain: ch1 查看序章行凶摸出的塑料袋
  surface: 以为是老韩的私人借据
  truth: 写有「刘亮，男，22岁，血型B」，颠覆被害人身份 → 解题链第 1 环
  links: [clue-downsize-list]
  staging: prop-card
  question: 身份谜（死在铁轮下的究竟是谁）

- id: clue-alibi-slip
  object: 社区非典体温筛查登记簿（存根）
  obtain: ch1 望哥半夜面门前出示
  surface: 宋明 22:15 进店体温 36.4℃，真实有效的铁证不在场证明
  truth: 既能保护宋明脱罪，又反噬其灵魂的道德铁笼
  links: []
  staging: paper-doc
  question: 利害谜（宋明能否置身事外）

- id: clue-fingerprint-report
  object: 刑侦勘验快报（抄件）
  obtain: ch3 从何峥刑警公文包中瞥见
  surface: 现场尸体指纹与老韩办公室高档茶杯指纹 100% 吻合
  truth: 老韩半月前以打杂为由污染了办公室对照样
  links: [clue-blood-card]
  staging: paper-doc
  question: 手法谜（法医物证为何被完美伪造）

- id: clue-insurance-policy
  object: 太平洋人寿保险综合意外险保单（复印件）
  obtain: ch3 周翠兰家中抽屉
  surface: 韩荣半年前投保 300 万，含第三方故意伤害身亡双倍赔付条款
  truth: 证明老韩与周翠兰合谋假死骗保的核心动机
  links: [clue-fingerprint-report]
  staging: paper-doc
  question: 动机谜（老韩为何非要被残忍他杀）

- id: clue-downsize-list
  object: 1997年内燃机厂改制下岗安置审批表
  obtain: ch4 刘亮合租屋床板夹层
  surface: 老工人刘建国被红笔划入首批下岗，签字审核人为宋明
  truth: 揭露主角六年前的原罪，完成底层互害的因果闭环
  links: [clue-blood-card]
  staging: paper-doc
  question: 道德谜（宋明与死者的宿命关联）

- id: clue-arc-scar
  object: 1983年国营老厂工伤医疗档案卡
  obtain: ch4 老工业区档案馆存根
  surface: 韩荣年轻时右小臂内侧被电焊电弧严重灼伤，留下不可磨灭的永久性菱形疤痕
  truth: 火车站决战时物理锁定活体老韩、撕下其伪装膏药的终极物证
  links: []
  staging: prop-card
  question: 手法谜（如何当众证明死人复生）
```
