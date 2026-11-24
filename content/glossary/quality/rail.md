---
id: rail
title: 量程与饱和
short: 信号超出放大器可记录范围就会被截平；后续滤波不能恢复丢失的峰值。
see: 「量程（%）」是峰值占满量程的比例；超过 90% 是软件饱和风险提示
tip: 持续饱和的电极：重新佩戴，确认电极贴住皮肤
level: 进阶
en: input range and clipping
related: contact,raw,sampling
---

## 原理

输入量程是电路能够表示的电压区间。接触偏置、悬空和强干扰都可能把信号推向边界。高硬件增益通常缩小可容纳输入，因此幅度很小的有用脑电也可能叠加在巨大偏置上而丢失。

显示缩放不会改变硬件量程。饱和波形可能产生额外频谱成分，误导模型；应先恢复接触、等待稳定，并重新采集受影响的数据段。

## 图示

![信号饱和](images/clipping.svg "理想输入与被截平记录的对照示意；丢失的峰值不能靠滤波还原")

## 典型数值

| 项目 | 范围或解释 |
|---|---|
| 量程百分比 | 峰值相对于当前满量程的占比 |
| 约 75% / 90% | 当前软件的筛查分界，非脑电生理阈值 |
| 截平之后 | 原始峰值大小无法由记录唯一恢复 |

## 在本软件里

在接触诊断看量程与原始波形。出现截顶或多路同时饱和时先暂停采集，再检查参考、BIAS 与电极。

## 常见误区

> [!误区] 把纵轴放大或加滤波就能修复饱和
> 这些只能改变显示或保留成分，无法补回超出量程的信息。

## 参考

- Sinha S. R. 等. [Minimum Technical Requirements for Performing Clinical Electroencephalography](https://scholarworks.indianapolis.iu.edu/items/8237ef7a-94e8-4bb1-8a0d-0dbd4033aa7a). Journal of Clinical Neurophysiology, 2016, 33:303–307. 本手册仅借鉴记录原理，不将软件视作临床设备。
- Widmann A., Schröger E., Maess B. [Digital filter design for electrophysiological data—a practical approach](https://home.uni-leipzig.de/biocog/eprints/widmann_a2015jneuroscimeth250_34.pdf). Journal of Neuroscience Methods, 2015, 250:34–46.
