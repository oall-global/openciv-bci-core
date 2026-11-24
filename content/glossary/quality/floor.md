---
id: floor
title: 高频底噪与通道相关性
short: 高频强度与通道相关性是排查线索，不能单独证明电极悬空或信号来源。
level: 专业
en: high-frequency RMS and channel correlation
related: reference,artifact,contact
---

## 原理

当前诊断把较高频范围的均方根强度作为噪声线索。该范围仍可能含真实高频活动、肌电、工频泄漏和电路噪声，所以“底噪”是操作性指标，不代表这里没有脑电。

通道相关性描述波形相似程度。悬空输入拾取同一干扰会提高它，真实共同活动、参考和体积传导也会提高它。接触良好并不要求通道彼此完全不相关。

## 图示

![六类常见伪迹](images/artifacts.svg "波形示意，幅度分别缩放；仅凭形状不能唯一确定来源")

## 典型数值

| 项目 | 范围或解释 |
|---|---|
| 诊断高频窗 | 采样条件允许时 65–95 Hz |
| 低采样率替代窗 | 当前实现使用 41–47 Hz，不能与前者直接比较 |
| 相关系数 | 通常 −1 至 1，解释依算法和窗口 |
| RMS | 单位 µV，受频带宽度影响 |

## 在本软件里

在「接触诊断」把这两项与量程、阻抗、波形一起看。高频增加时先放松额头、下颌并减少线缆移动。

## 常见误区

> [!误区] 高相关必然是坏信号，低相关必然是好信号
> 共同参考会造成高相关，独立噪声也可能产生低相关。

## 参考

- Whitham E. M. 等. [Scalp electrical recording during paralysis: quantitative evidence that EEG frequencies above 20 Hz are contaminated by EMG](https://pubmed.ncbi.nlm.nih.gov/17574912/). Clinical Neurophysiology, 2007, 118:1877–1888.
- Nunez P. L., Srinivasan R. Electric Fields of the Brain: The Neurophysics of EEG. Oxford University Press, 第 2 版, 2006.
