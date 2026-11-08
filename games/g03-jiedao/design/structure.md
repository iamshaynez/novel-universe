# g03《借刀》游戏结构与拓扑设计（Structure）

## 1. 章节拓扑与场景列表

```mermaid
flowchart TD
  S0["ch0-rain (雨夜伏击)"] --> S0_hit["ch0-strike (滑轮砸落)"]
  S0_hit --> S1_morning["ch1-dawn (晨间开铺)"]
  S1_morning --> S1_police["ch1-inquiry (何峥上门查访)"]
  S1_police --> S1_card["ch1-shock (查看血染献血证)"]
  S1_card --> S2_call["ch2-ring (午夜电话响起)"]
  S2_call --> S2_choice{"ch2-react (接听对峙)"}
  S2_choice -->|沉默听完| S3_forensic["ch3-investigate (查访法医线索)"]
  S2_choice -->|愤怒质问| S3_forensic
  S3_forensic --> S3_wife["ch3-confront-wife (周翠兰试探)"]
  S3_wife --> S4_slum["ch4-shack (搜查刘亮地下室)"]
  S4_slum --> S4_archive["ch4-archive (翻查1997年旧档与工伤卡)"]
  S4_archive --> S5_station["ch5-north-station (火车北站大雾)"]
  S5_station --> S5_gate{"终章大决择"}
  S5_gate -->|刺魔自首揭穿疤痕| END_TRUTH["END_TRUTH · 归名"]
  S5_gate -->|交付钱箱远走他乡| END_MISS["END_MISS · 幽魂"]
  S5_gate -->|空口无凭揭发被捕| END_WRONG["END_WRONG · 疯汉"]
```

## 2. 门禁规则（Gates）
* 进入 `END_TRUTH` 必须同时拥有 flags：
  * `fact.ev-g03-murder`（泵站命案事实）
  * `has_blood_card`（持有刘亮献血证）
  * `has_scar_archive`（持有电弧焊烫伤档案）
  * 做出抉择：`choice_confess_stab`（当众刺魔自首）
* 若未持 `has_scar_archive` 却试图指控，落入 `END_WRONG`；
* 若选择妥协交包，落入 `END_MISS`。
