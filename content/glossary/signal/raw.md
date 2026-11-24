---
id: raw
title: 原始波形与微伏（µV）
short: 波形表示电压随时间变化；“原始数据”、显示滤波和纵轴缩放要分开理解。
see: 所选电极最近一段波形；先核对纵轴单位、范围和显示滤波
tip: 在右侧列表里点另一个电极可以切换
level: 进阶
en: raw waveform and microvolt
related: artifact,rail,power
---

## 原理

时域波形让人检查漂移、节律、大幅突变和截顶。图上变高可能来自实际电压变化，也可能仅仅因为纵轴缩放改变。峰值、峰峰值和均方根（RMS）不是同一种幅度。

界面为了便于观察可能进行滤波、去均值或缩放。因此“波形页”不一定等于未经处理的采集数据。分析与导出时应记录所用信号版本，避免把处理后波形当作原始记录。

## 图示

![六类常见伪迹](images/artifacts.svg "波形示意，幅度分别缩放；仅凭形状不能唯一确定来源")

## 典型数值

| 项目 | 范围或解释 |
|---|---|
| 单位换算 | 1 mV = 1000 µV |
| 峰峰值 | 一个时间窗内最大值减最小值 |
| 正弦示例 | 峰值 10 µV 时，峰峰值 20 µV、RMS 约 7.1 µV |

## 在本软件里

在「信号工作台」对比波形、接触与频谱。波形显得平直时先检查纵轴、通道是否被禁用和连接状态，再判断是否缺少信号。

## 常见误区

> [!误区] 波越大说明大脑越活跃
> 大幅波动常来自眼动、肌肉或电极移动，不能用幅度直接评价脑功能。

## 参考

- Kane N. 等. [A revised glossary of terms most commonly used by clinical electroencephalographers… Revision 2017](https://pubmed.ncbi.nlm.nih.gov/30214992/). Clinical Neurophysiology Practice, 2017, 2:170–185.
- Cohen M. X. Analyzing Neural Time Series Data: Theory and Practice. MIT Press, 2014.
