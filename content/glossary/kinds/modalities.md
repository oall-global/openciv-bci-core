---
id: modalities
title: 脑电与其他脑成像方式
short: 电生理记录直接跟随电磁活动，血氧成像反映较慢的血流变化；不同方式互补。
level: 专业
en: EEG, MEG, fMRI and fNIRS
related: brainmap,invasive
---

## 原理

EEG 测电压差，MEG 测神经电流相关的磁场；两者都能跟随快速活动，但源定位依赖头模型、传感器布置及信噪比。fMRI 与 fNIRS 通常通过血氧或血流变化间接研究活动，生理响应比电活动慢。

空间分辨率不能只看图像像素或电极间距。fMRI 的体素尺寸不等于实际定位准确度，fNIRS 主要敏感于浅表组织，皮层内电极也只覆盖被植入的一部分区域。

## 图示

![记录方式的时空尺度](images/modalities.svg "典型能力范围的定性示意，不是设备性能排名；血氧响应速度与采样率不同")

## 典型数值

| 项目 | 范围或解释 |
|---|---|
| EEG / MEG | 时间尺度可达毫秒，空间定位依模型 |
| fMRI | 常见毫米级体素，血氧响应为秒级 |
| fNIRS | 常见厘米量级空间敏感范围，血氧响应为秒级 |
| 植入式电极 | 可获得局部精细记录，覆盖与侵入代价需同时考虑 |

## 在本软件里

主图是头皮数值插值显示，并非 MRI 或精确脑源图。本软件不能仅靠头皮 EEG 还原这些其他方式的信息。

## 常见误区

> [!误区] 颜色图越细，测量空间精度越高
> 绘图网格可以很密，但实际信息量受测量与模型限制。

## 参考

- Buzsáki G., Anastassiou C. A., Koch C. [The origin of extracellular fields and currents—EEG, ECoG, LFP and spikes](https://pubmed.ncbi.nlm.nih.gov/22595786/). Nature Reviews Neuroscience, 2012, 13:407–420.
- Li R. 等. [Concurrent fNIRS and EEG for Brain Function Investigation: A Systematic, Methodology-Focused Review](https://pubmed.ncbi.nlm.nih.gov/35957421/). Sensors, 2022.
