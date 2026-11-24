---
id: neural
title: 神经元信号与脑区连接（示意）
short: 神经元与连接动画是信号驱动的示意；同步不代表直接连接、因果或信息流向。
see: 主图上闪烁的光点和脑区之间流动的连线，都是由脑电驱动的示意
tip: 在左下角的图例里可以关闭
level: 专业
en: schematic neural activity and phase-locking value
related: brainmap,reference,floor
---

## 原理

神经元闪光把头皮节律映射为容易理解的动画，并没有逐个记录神经元。相位锁定值（PLV）则描述一段时间内两个振荡的相位差是否稳定。

共同参考、体积传导和共同源都能产生高同步。PLV 对选定频段、窗口和噪声敏感，单靠它不能证明结构连接，也不能确定哪个脑区驱动另一个。动画中的流动方向属于视觉表达。

## 图示

![神经元群到头皮电位](images/origin.svg "同步的突触电流经组织传导形成头皮电位；示意，不代表单神经元测量")

## 典型数值

| 项目 | 范围或解释 |
|---|---|
| PLV 理论范围 | 0–1；越大表示相位差越集中 |
| 有限样本 | 即使无真实联系也可能出现非零估计 |
| 解剖连接 | 不能由这一指标直接确定 |

## 在本软件里

把主图里的闪光和连线作为观察节律变化的辅助。若要研究连接，需要另行设计参考、伪迹控制和统计检验。

## 常见误区

> [!误区] 连线变亮就表示两区开始通信
> 共同信号也能让连线变亮，不能据此报告新增神经连接。

## 参考

- Nunez P. L., Srinivasan R. Electric Fields of the Brain: The Neurophysics of EEG. Oxford University Press, 第 2 版, 2006.
- Cohen M. X. Analyzing Neural Time Series Data: Theory and Practice. MIT Press, 2014.
