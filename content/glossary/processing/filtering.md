---
id: filtering
title: 高通、低通与陷波
short: 滤波选择保留的频率成分，也会改变波形与时序；参数必须随分析结果一起记录。
level: 进阶
en: high-pass, low-pass and notch filtering
related: sampling,mains,raw
---

## 原理

高通衰减慢漂移，低通衰减较快成分，陷波抑制工频附近。真实滤波器都有过渡带和边缘效应，不能看成一刀切地留下“好信号”、删除“坏信号”。

在线因果滤波会引入延迟，离线双向滤波可改变事件前后的形状。切段太短或对突变进行滤波可能产生振铃。比较实验时需统一滤波与参考，保留原始数据以便复查。

## 图示

![采样、滤波和频谱](images/processing.svg "从波形到频谱的处理示意；改变参数会改变可观察的细节")

## 典型数值

| 项目 | 范围或解释 |
|---|---|
| 高通示例 | 0.5 或 1 Hz 等仅为方法示例，是否适用取决于目标 |
| 低通示例 | 40 Hz 会排除更高频信息，不能再研究该部分 |
| 陷波中心 | 按环境选 50 或 60 Hz |
| 记录参数 | 截止频率、阶数、滤波方向与实际采样率 |

## 在本软件里

检查当前页面和分析所用滤波设置。显示滤波未必改变保存的原始文件；导出与研究时要说明采用哪个版本。

## 常见误区

> [!误区] 滤波越强，科学结论越可靠
> 过度滤波可能删去目标信号或改变事件波形，应以问题需要为准。

## 参考

- Widmann A., Schröger E., Maess B. [Digital filter design for electrophysiological data—a practical approach](https://home.uni-leipzig.de/biocog/eprints/widmann_a2015jneuroscimeth250_34.pdf). Journal of Neuroscience Methods, 2015, 250:34–46.
