---
id: window
title: 窗口长度与频率分辨率
short: 窗口越长，频率网格越细，但变化被更多时间平均；更新快不代表窗口短。
level: 进阶
en: analysis window and frequency resolution
related: sampling,spectrum-analysis
---

## 原理

长度为 T 秒的一段数据，其基本傅里叶频率间距约为 1/T Hz。实际区分相邻频率的能力还受窗函数、噪声和估计方法限制。补零使曲线更密，并不增加原始信息。

短窗便于跟踪变化，长窗更适合估计稳定频率。重叠窗口让画面更新平滑，但相邻结果共享数据。报告响应速度时，应把窗口长度、步长、计算和触发保持区分开。

## 图示

![采样、滤波和频谱](images/processing.svg "从波形到频谱的处理示意；改变参数会改变可观察的细节")

## 典型数值

| 项目 | 范围或解释 |
|---|---|
| 1 秒窗口 | 频率网格约 1 Hz |
| 2 秒窗口 | 约 0.5 Hz |
| 4 秒窗口 | 约 0.25 Hz，若内部再分段则以分段长度计算 |
| 当前 α 频谱实现 | 近 4 秒数据内采用 2 秒分段平均，频率间距约 0.5 Hz |

## 在本软件里

观察闭眼变化时给窗口留出稳定时间。任务评分约每 0.5 秒更新，却使用约 2 秒历史；不要把画面刷新频率当作独立测量次数。

## 常见误区

> [!误区] 补更多零就能分清任意接近的两个峰
> 补零只是对已有频谱的更密采样，真实分辨能力仍受数据时长等因素约束。

## 参考

- Cohen M. X. Analyzing Neural Time Series Data: Theory and Practice. MIT Press, 2014.
- Widmann A., Schröger E., Maess B. [Digital filter design for electrophysiological data—a practical approach](https://home.uni-leipzig.de/biocog/eprints/widmann_a2015jneuroscimeth250_34.pdf). Journal of Neuroscience Methods, 2015, 250:34–46.
