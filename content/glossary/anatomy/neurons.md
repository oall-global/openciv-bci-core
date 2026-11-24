---
id: neurons
title: 神经元、突触与同步
short: 头皮脑电主要反映神经元群电流的叠加，不是逐个动作电位的计数。
level: 入门
en: neurons, synapses and population activity
related: eeg,neural,anatomy
---

## 原理

神经元通过细胞膜上的离子流改变电位，在突触处接收输入。动作电位是短暂的传播信号，突触相关电流则可以在空间与时间上叠加。方向较一致的皮层细胞群对头皮场的贡献尤其重要。

同步程度、细胞排列和相互抵消共同决定远处能测到多大电位。更强的头皮振荡不必然意味着所有细胞放电更多，节律减弱也可能伴随某些信息处理活动增强。

## 图示

![神经元群到头皮电位](images/origin.svg "同步的突触电流经组织传导形成头皮电位；示意，不代表单神经元测量")

## 典型数值

| 项目 | 范围或解释 |
|---|---|
| 单元放电 | 需要靠近神经元的记录条件 |
| 头皮 EEG | 群体场信号，与单元放电不一一对应 |
| 幅度影响 | 电流强度、同步、方向、距离与参考共同决定 |

## 在本软件里

看到神经元动画时，理解为对群体信号的可视化。学习运动想象时可结合 [[paradigms]] 理解“活动参与时节律反而减弱”。

## 常见误区

> [!误区] 振荡幅度小就是神经元没有工作
> 不同细胞活动可能相互抵消，信息处理也不总表现为同步振荡增大。

## 参考

- Buzsáki G., Anastassiou C. A., Koch C. [The origin of extracellular fields and currents—EEG, ECoG, LFP and spikes](https://pubmed.ncbi.nlm.nih.gov/22595786/). Nature Reviews Neuroscience, 2012, 13:407–420.
- Pfurtscheller G., Lopes da Silva F. H. [Event-related EEG/MEG synchronization and desynchronization: basic principles](https://pubmed.ncbi.nlm.nih.gov/10576479/). Clinical Neurophysiology, 1999, 110:1842–1857.
