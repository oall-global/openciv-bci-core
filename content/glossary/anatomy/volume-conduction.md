---
id: volume-conduction
title: 体积传导与头皮测量的边界
short: 电场通过头部组织传播并混合；皮层对头皮 EEG 贡献突出，但不能说只能测到皮层。
level: 进阶
en: volume conduction and source ambiguity
related: neural,reference,brainmap
---

## 原理

不同组织的导电性质和几何形状改变电场分布，颅骨使头皮分布更平滑。多个源可以形成相似的头皮图，这就是仅凭测量难以唯一反推来源的重要原因。

头皮 EEG 通常对同步皮层群体电流更敏感。深部结构可以通过网络影响皮层，也可能在适当条件下贡献可测信号；但低密度头皮记录难以可靠分离深部来源。

## 图示

![三种电极记录位置](images/layers.svg "头皮、皮层表面和皮层内记录位置示意；层厚不按比例")

## 典型数值

| 项目 | 范围或解释 |
|---|---|
| 传播效应 | 空间扩散、混合与衰减，不是逐层复制 |
| 源定位 | 需模型与先验约束，通常没有唯一解 |
| 默认 16 通道 | 不支持仅凭彩色图确认特定深部结构 |

## 在本软件里

把头图视作空间概览。若两通道同步或颜色相似，先考虑共同源与参考，再讨论连接。

## 常见误区

> [!误区] 两个电极有相关性就证明两处脑区直接连通
> 同一个源通过组织传导即可同时影响多个电极。

## 参考

- Nunez P. L., Srinivasan R. Electric Fields of the Brain: The Neurophysics of EEG. Oxford University Press, 第 2 版, 2006.
- Buzsáki G., Anastassiou C. A., Koch C. [The origin of extracellular fields and currents—EEG, ECoG, LFP and spikes](https://pubmed.ncbi.nlm.nih.gov/22595786/). Nature Reviews Neuroscience, 2012, 13:407–420.
