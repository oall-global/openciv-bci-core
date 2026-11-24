---
id: pipeline
title: 一个脑机接口是怎么工作的
short: 脑机接口依次完成采集、预处理、特征提取、识别与输出，各步都影响最终结果。
level: 入门
en: signal-processing pipeline
related: sampling
---

## 原理

采集把电压转换成带时间标记的数字样本。预处理按分析目标处理漂移和干扰，识别坏段。特征提取把长波形压缩成频段功率、空间模式或事件相关波形等信息。

训练建立特征与标签的对应关系，验证检验新数据是否仍然可分。在线输出还要经过阈值、保持和冷却规则。滤波不能修复丢失或饱和的数据，控制成功也不能倒推每一步都正确。

## 图示

![脑机接口处理流程](images/pipeline.svg "从采集到输出的流程示意；每一步都可能引入误差")

## 典型数值

| 项目 | 范围或解释 |
|---|---|
| 采集速率 | 以连接设备实际采样率为准 |
| 当前任务识别窗口 | 约 2 秒，每 0.5 秒更新 |
| 控制延迟 | 数据窗口、计算、保持时间和输出延迟共同构成 |

## 在本软件里

「信号工作台」检查采集；任务的「数据采集」准备标签；「模型与输出」训练验证；触发规则预览检查控制逻辑。

## 常见误区

> [!误区] 每 0.5 秒更新就是只看最近 0.5 秒
> 更新间隔与分析窗口不同，相邻窗口通常共享大量数据。

## 参考

- Wolpaw J. R. 等. [Brain–computer interfaces for communication and control](https://pubmed.ncbi.nlm.nih.gov/12048038/). Clinical Neurophysiology, 2002, 113:767–791.
- Cohen M. X. Analyzing Neural Time Series Data: Theory and Practice. MIT Press, 2014.
