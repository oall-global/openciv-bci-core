---
id: active-passive
title: 主动式与被动式
short: 主动式靠自主调节，反应式借助外部刺激，被动式估计状态；三者的实验要求不同。
level: 进阶
en: active, reactive and passive BCI
related: paradigms,baseline,limits
---

## 原理

主动式接口让人自主改变某种活动，例如运动想象。反应式接口利用对外部刺激的反应，例如注视闪烁目标或注意稀有目标；使用者仍需配合，但信号被刺激组织起来。

被动式接口不要求专门发出命令，而是估计任务过程中自然发生的变化。它尤其需要独立验证：一个频段或比值不能普遍等同于专注、疲劳或放松。三种形式可以组合。

## 图示

![脑机接口处理流程](images/pipeline.svg "从采集到输出的流程示意；每一步都可能引入误差")

## 典型数值

| 项目 | 范围或解释 |
|---|---|
| 主动式示例 | 运动想象 |
| 反应式示例 | SSVEP、P300 |
| 被动式示例 | 经验证的工作负荷估计，不是通用读心 |

## 在本软件里

先读任务提示，区分“主动做动作”“注意刺激”和“自然完成任务”。使用「应用」中的状态可视化时，把它作为反馈指标而非标准心理测量。

## 常见误区

> [!误区] 被动式不需要校准
> 不需要主动发命令，不代表无需个人基线、标签或效果验证。

## 参考

- Wolpaw J. R. 等. [Brain–computer interfaces for communication and control](https://pubmed.ncbi.nlm.nih.gov/12048038/). Clinical Neurophysiology, 2002, 113:767–791.
