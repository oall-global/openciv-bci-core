---
id: mains
title: 工频干扰
short: 电网及周边设备可在 50 或 60 Hz 及其谐波处引入干扰，接触不平衡会加重它。
see: 「工频（µV）」描述电源频率附近的干扰强度，需结合接触与滤波
tip: 远离插线板和充电器，确认头顶的参考电极和 BIAS 贴好
level: 进阶
en: power-line interference
related: filtering,impedance,rail
---

## 原理

电线和设备产生的电场可耦合到人体与导线。放大器虽能抑制部分共同干扰，但高阻抗、不平衡接触与参考问题会使干扰进入差分信号。

陷波滤波器抑制指定频率附近的成分，同时也会改变该区域的真实信号。若干扰已导致饱和，陷波无法恢复原始脑电。应先处理接触、走线和干扰源，再选择适当滤波。

## 图示

![脑电功率谱](images/spectrum.svg "非周期背景与 α 峰示意；纵轴为任意单位，不是用户数据")

## 典型数值

| 项目 | 范围或解释 |
|---|---|
| 电网基频 | 不同地区通常为 50 或 60 Hz |
| 常见谐波 | 100/120 Hz 等，是否可见受采样率限制 |
| 陷波影响 | 中心附近一段频率，不只是一个理想点 |

## 在本软件里

在频谱中寻找稳定窄峰，核对设备和分析的工频设置。固定导线并远离明显干扰源；不要移除电气保护措施来消除噪声。

## 常见误区

> [!误区] 看不到 50 Hz 峰就一定接触良好
> 滤波可能已经隐藏它，其他频率也可能被伪迹污染。

## 参考

- Sinha S. R. 等. [Minimum Technical Requirements for Performing Clinical Electroencephalography](https://scholarworks.indianapolis.iu.edu/items/8237ef7a-94e8-4bb1-8a0d-0dbd4033aa7a). Journal of Clinical Neurophysiology, 2016, 33:303–307. 本手册仅借鉴记录原理，不将软件视作临床设备。
- Widmann A., Schröger E., Maess B. [Digital filter design for electrophysiological data—a practical approach](https://home.uni-leipzig.de/biocog/eprints/widmann_a2015jneuroscimeth250_34.pdf). Journal of Neuroscience Methods, 2015, 250:34–46.
