---
id: paradigms
title: 常见范式：节律、SSVEP、P300、运动想象
short: 范式通过明确任务与刺激组织信号；不同范式需要不同的时间标记、特征和验证方法。
level: 专业
en: BCI paradigms: SSVEP, P300 and motor imagery
related: alpha,artifact
---

## 原理

SSVEP 利用周期性视觉刺激，在后部信号中寻找刺激频率及其谐波的响应。P300 范式关注被注意目标出现后的事件相关响应，通常需要多次事件对齐或平均，峰并非固定发生在 300 毫秒。

运动想象常分析感觉运动区 mu 与 β 节律的功率降低（ERD），但并非每人每次都明显。闭眼任务主要比较后部 α。眨眼和咬牙产生的眼电、肌电可以控制界面，却不属于纯脑电范式。

## 图示

![三种范式的信号](images/paradigms.svg "SSVEP 频谱、P300 事件平均、运动想象节律功率变化示意，非同一测量单位")

## 典型数值

| 项目 | 范围或解释 |
|---|---|
| mu | 常讨论约 8–13 Hz，关注中央区 |
| β | 常讨论约 13–30 Hz |
| P300 | 常在事件后数百毫秒，随任务与人变化 |
| SSVEP | 观察刺激频率及谐波，避免只凭单个谱峰判断 |

## 在本软件里

在「探索」和「控制」中按对应引导操作。不要把通用频段分类器的结果当成已经验证的 P300 检测；先确认任务实际采用的信号和时间标记。

## 常见误区

> [!误区] 任意 10 Hz 峰都是视觉诱发响应
> 自然 α 也可能在相近频率出现，需比较刺激条件、通道分布和谐波。闪烁相关注意事项见 [[safety]]。

## 参考

- Wolpaw J. R. 等. [Brain–computer interfaces for communication and control](https://pubmed.ncbi.nlm.nih.gov/12048038/). Clinical Neurophysiology, 2002, 113:767–791.
- Pfurtscheller G., Lopes da Silva F. H. [Event-related EEG/MEG synchronization and desynchronization: basic principles](https://pubmed.ncbi.nlm.nih.gov/10576479/). Clinical Neurophysiology, 1999, 110:1842–1857.
