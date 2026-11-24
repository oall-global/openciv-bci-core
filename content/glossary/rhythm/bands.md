---
id: bands
title: 频段（δ θ α β γ）
short: 软件频段：δ 1–4 Hz、θ 4–8 Hz、α 8–13 Hz、β 13–30 Hz、γ 30–40 Hz；不是情绪标签。
see: 左侧五行：δ θ α β γ，每行的倍数是全部电极相对放松时的平均
tip: 点某一行，大脑颜色就显示这个节律；新手先看 α
level: 入门
en: EEG frequency bands
related: alpha,power,artifact
---

## 原理

频段是便于分析的频率区间，不是五种互斥的脑状态。真实信号同时含多个节律、非周期背景和噪声。不同文献的边界可能略有差异，比较结果时应先看定义。

某个频段与某种任务的联系具有脑区、时间和实验条件限制。尤其 β、γ 会混入肌电，低频也容易混入眼动和漂移。不能把 δ、θ、α、β、γ 顺次解释为睡眠到高度专注的刻度。

## 图示

![五个频段的波形](images/waves.svg "同为 1 秒的等幅正弦波示意；真实脑电是多种成分与噪声的混合")

## 典型数值

| 项目 | 范围或解释 |
|---|---|
| δ | 本软件 1–4 Hz；文献可能从 0.5 Hz 起算 |
| θ | 4–8 Hz |
| α | 8–13 Hz |
| β | 13–30 Hz |
| γ | 本软件只统计 30–40 Hz，不代表 γ 的完整研究范围 |

## 在本软件里

在「信号工作台」切换频段，同时观察波形和信号质量。频段功率、相对总功率百分比和相对基线倍数是不同指标，见 [[power]]。

## 常见误区

> [!误区] β 高就是专注，γ 高就是思维快
> 频段变化没有这种一一对应关系，面部用力也可能造成明显升高。

## 参考

- Kane N. 等. [A revised glossary of terms most commonly used by clinical electroencephalographers… Revision 2017](https://pubmed.ncbi.nlm.nih.gov/30214992/). Clinical Neurophysiology Practice, 2017, 2:170–185.
- Whitham E. M. 等. [Scalp electrical recording during paralysis: quantitative evidence that EEG frequencies above 20 Hz are contaminated by EMG](https://pubmed.ncbi.nlm.nih.gov/17574912/). Clinical Neurophysiology, 2007, 118:1877–1888.
