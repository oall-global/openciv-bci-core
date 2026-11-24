---
id: eeg
title: 脑电（EEG）
short: 脑电是头皮电极记录到的微弱电压差，主要反映大量神经元群活动的叠加。
level: 入门
en: electroencephalography (EEG)
related: reference,raw,anatomy
---

## 原理

头皮脑电的重要来源是皮层神经元群的突触相关跨膜电流。许多方向相近的细胞在时间上协同活动时，形成的电场更容易在较远处被测到；单个神经元的放电一般不能由普通头皮电极单独分辨。

信号经过脑组织、脑脊液、颅骨和头皮传导，会发生空间扩散与衰减。电极记录的是相对于参考位置的电压差，还混有眼球、肌肉和环境电信号。因此波形清晰不等于来源已经确定。

## 图示

![神经元群到头皮电位](images/origin.svg "同步的突触电流经组织传导形成头皮电位；示意，不代表单神经元测量")

## 典型数值

| 项目 | 范围或解释 |
|---|---|
| 常见量级 | 头皮信号常为几至几十 µV，依参考和幅度定义而变 |
| 单位 | 1 µV = 0.000001 V |
| 时间刻度 | 250 Hz 采样时每点相隔 4 ms，不等于所有分析延迟均为 4 ms |

## 在本软件里

在「信号工作台」同时看波形、频谱和接触状态。先检查参考及接触，再解释频段变化，参见 [[reference]] 与 [[artifact]]。

## 常见误区

> [!误区] 一个电极只看它正下方的一小块脑区
> 每个电极都受多个源及参考电极影响，头皮位置不能直接转换成独立脑区活动。

## 参考

- Buzsáki G., Anastassiou C. A., Koch C. [The origin of extracellular fields and currents—EEG, ECoG, LFP and spikes](https://pubmed.ncbi.nlm.nih.gov/22595786/). Nature Reviews Neuroscience, 2012, 13:407–420.
- Nunez P. L., Srinivasan R. Electric Fields of the Brain: The Neurophysics of EEG. Oxford University Press, 第 2 版, 2006.
