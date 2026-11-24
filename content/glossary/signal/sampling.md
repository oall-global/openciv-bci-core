---
id: sampling
title: 采样率与增益
short: 采样率决定时间采样间隔，增益影响输入量程；更高不总是更好。
see: 标题栏的「16 通道 · 250 Hz · 增益 24×」是设备的硬件参数
tip: 一般不需要修改；需要时在「设置 → 连接偏好」里调整
level: 进阶
en: sampling rate, Nyquist frequency and gain
related: filtering,window,rail
---

## 原理

采样率 fs 是每秒每通道的采样点数。理想重建要求所关注信号的最高频率低于 fs/2，并在采样前限制更高频成分，否则它们会混叠成低频。实际滤波需要过渡带，不能把奈奎斯特边界当成完美可用频率。

增益让微小电压更充分利用转换器，但通常会缩小允许输入范围。软件纵轴放大只改变显示，不等于硬件增益。连接模式也可能影响有效采样率，必须读取实际记录信息。

## 图示

![采样、滤波和频谱](images/processing.svg "从波形到频谱的处理示意；改变参数会改变可观察的细节")

## 典型数值

| 项目 | 范围或解释 |
|---|---|
| 250 Hz 示例 | 采样间隔 4 ms，奈奎斯特频率 125 Hz |
| 125 Hz 示例 | 采样间隔 8 ms，奈奎斯特频率 62.5 Hz |
| 增益 | 以连接配置为准，默认配置常用 24 倍 |

## 在本软件里

在设备连接信息和记录元信息中确认采样率；不要仅按“16 通道”推断速率。量程不足时先排查接触和偏置，见 [[rail]]。

## 常见误区

> [!误区] 事后低通滤波能够完全消除混叠
> 混叠发生后，落入目标频段的成分通常不能再与真实低频信号分开。

## 参考

- Cohen M. X. Analyzing Neural Time Series Data: Theory and Practice. MIT Press, 2014.
- Widmann A., Schröger E., Maess B. [Digital filter design for electrophysiological data—a practical approach](https://home.uni-leipzig.de/biocog/eprints/widmann_a2015jneuroscimeth250_34.pdf). Journal of Neuroscience Methods, 2015, 250:34–46.
