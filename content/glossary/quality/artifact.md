---
id: artifact
title: 伪迹：眼电与肌电
short: 伪迹是混入脑电的其他信号；眨眼、咬牙、移动、工频和接触变化都可能造成。
see: 眨眼时额部波形出现大尖峰，咬牙时颞部波形变密变粗
tip: 采集脑电任务时放松面部、少眨眼；想用它们控制时，选「咬牙」「眨眼」类模板
level: 入门
en: artifact, EOG and EMG
related: raw,floor,experiment
---

## 原理

眼球的电位分布使眨眼和眼动常在前额产生大幅慢变化；肌肉活动频谱更宽，咬牙和皱眉尤其容易污染较高频段。电极移动、线缆晃动与接触界面变化可产生突跳或漂移。

辨认伪迹应结合发生时间、行为、空间分布和频谱，而非仅凭一条波形。实验可短暂主动眨眼帮助认识形态，但正式采集应按统一要求行动，并标记明显污染段。

## 图示

![六类常见伪迹](images/artifacts.svg "波形示意，幅度分别缩放；仅凭形状不能唯一确定来源")

## 典型数值

| 项目 | 范围或解释 |
|---|---|
| 眼电 | 常见数十至数百 µV，但随导联变化 |
| 肌电 | 常在 20 Hz 以上明显，也可影响更低频 |
| 工频 | 通常 50 或 60 Hz 及谐波 |
| 移动与松动 | 可形成宽带突变、慢漂移或饱和 |

## 在本软件里

在波形页短暂眨眼一次，观察 Fp1/Fp2；轻轻收紧下颌后立即放松，比较颞部通道。身体不适就停止。眼肌控制任务与脑电任务应分别解释。

## 常见误区

> [!误区] 滤波之后剩下的就全是脑电
> 肌电与脑电频谱重叠，滤波不能保证来源纯净；用于控制的肌电也不应伪装成脑电成果。

## 参考

- Whitham E. M. 等. [Scalp electrical recording during paralysis: quantitative evidence that EEG frequencies above 20 Hz are contaminated by EMG](https://pubmed.ncbi.nlm.nih.gov/17574912/). Clinical Neurophysiology, 2007, 118:1877–1888.
- Sinha S. R. 等. [Minimum Technical Requirements for Performing Clinical Electroencephalography](https://scholarworks.indianapolis.iu.edu/items/8237ef7a-94e8-4bb1-8a0d-0dbd4033aa7a). Journal of Clinical Neurophysiology, 2016, 33:303–307. 本手册仅借鉴记录原理，不将软件视作临床设备。
