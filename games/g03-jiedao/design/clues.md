# g03《借刀》线索系统设计（Clues）

> v1.1（血肉重构）：6→9 卡，兑现立项「8-12 张核心证物卡」承诺。每卡必须挂靠一个活的读者问题（指南 P2 完成门）。

```yaml
- id: clue-blood-card
  object: 染血的四川省无偿献血证
  obtain: ch0 行凶贴身搜出，ch1 灯下查看
  surface: 以为是老韩的私人借据
  truth: 写有「刘亮，男，22岁，血型B」，颠覆被害人身份 → 解题链第 1 环
  links: [clue-sewn-pocket, clue-downsize-list]
  staging: prop-card
  question: 身份谜（死在铁轮下的究竟是谁）

- id: clue-sewn-pocket
  object: 贴身缝袋（张桂芳缝在刘亮旧褂子里的暗袋）
  obtain: ch0 搜身动作 + ch2 韩荣电话里一句「他老娘缝的贴身口袋」
  surface: 搜身时的一个多余动作
  truth: 解释献血证为何躲过韩荣的搜检——全篇赖以成立的「失误」有了针脚，且把刘亮的母亲提前织进物证链
  links: [clue-blood-card, clue-notebook]
  staging: prop-card
  question: 手法谜（万无一失的布局为何漏掉唯一翻案物）

- id: clue-alibi-slip
  object: 社区非典体温筛查登记簿（存根）
  obtain: ch1 半夜面门前出示
  surface: 宋明 22:15 进店体温 36.4℃，看似铁证不在场证明
  truth: 只钉得住 22:15 一刻，盖不住 21:31 行凶窗——何峥的算术（大路四十分钟）反而证明宋明「来得及」；既能庇护也能反噬的道德铁笼
  links: []
  staging: paper-doc
  question: 利害谜（宋明能否置身事外）

- id: clue-fingerprint-report
  object: 刑侦勘验快报（桌面瞥见）
  obtain: ch3 顺兴茶铺，桌面一瞥 + 老彭一句「无前科只能取日常遗留样」
  surface: 现场尸体指纹与老韩办公室高档茶杯指纹 100% 吻合
  truth: 老韩半月前以打杂为由污染了办公室对照样——由宋明自行推理而非警察宣讲
  links: [clue-blood-card]
  staging: paper-doc
  question: 手法谜（法医物证为何被完美伪造）

- id: clue-insurance-policy
  object: 中国人寿人身意外伤害综合保障计划保单
  obtain: ch3 周翠兰家中抽屉（五斗橱半开）
  surface: 韩荣投保 300 万，含第三方恶意他杀双倍赔付条款
  truth: 证明老韩与周翠兰合谋假死骗保的核心动机；亦解释火化为何必须赶在今天
  links: [clue-fingerprint-report, clue-cremation]
  staging: paper-doc
  question: 动机谜（老韩为何非要被残忍他杀）

- id: clue-cremation
  object: 《家属对死因及身份无异议确认书》与当日火化通知
  obtain: ch3 老彭转述 + 13:00 殡仪馆窗口亲历
  surface: 遗孀认尸、入土为安的寻常手续
  truth: 司法闭环的最后一针；宋明请求暂缓被「无利害关系人」挡回——掏献血证即自证杀人，制度之墙把北站孤注一掷变成唯一出路
  links: [clue-insurance-policy]
  staging: paper-doc
  question: 时钟谜（为什么合法渠道全部走不通）

- id: clue-downsize-list
  object: 1997 年内燃机厂改制下岗安置审批表
  obtain: ch4 刘亮住处床板夹层
  surface: 老工人刘建国被划入首批下岗，签字审核人为宋明
  truth: 揭露主角六年前的原罪，完成底层互害的因果闭环
  links: [clue-blood-card, clue-notebook]
  staging: paper-doc
  question: 道德谜（宋明与死者的宿命关联）

- id: clue-notebook
  object: 刘亮的笔谈本（铅笔、歪扭字）
  obtain: ch4 搪瓷缸下，读完名册之后
  surface: 哑巴少年的流水账
  truth: 死者之声——三则日记收束于 11 月 12 日（替老板收账/莫说话对三下火机/给娘交透析费），11 月 2 日配钥匙那天写着「宋师傅给我倒了热水」；与 ch3 何峥质问钥匙来历时的记忆闪回互证
  links: [clue-downsize-list, clue-sewn-pocket]
  staging: prop-card
  question: 情感谜（死在滑轮下的是个什么样的人）

- id: clue-arc-scar
  object: 1983 年国营老厂工伤医疗档案卡
  obtain: ch4 留守处档案楼（配合宋明的大澡堂记忆）
  surface: 韩荣年轻时右小臂内侧电弧灼伤，留下永久性菱形疤痕
  truth: 火车站决战时物理锁定活体老韩、撕下其伪装膏药的终极物证——记忆知道，纸才能证明
  links: []
  staging: prop-card
  question: 手法谜（如何当众证明死人复生）
```

红鲱鱼登记：
- **办公室「铁证指纹」**：clue-fingerprint-report 的 surface，ch3 由宋明亲手拆解回收。
- **「无可辩驳」的家属认尸**：clue-cremation 的 surface，ch3 殡仪馆一场戏拆解其「不可逆」并转化为终局压力。
- **血型都是 B**：老彭一句闲话——血型对上了也证明不了任何事，恰好是四重定案锁里最便宜的一重（设计稿 Bug2 补进正文）。
