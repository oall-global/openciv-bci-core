---
id: reference
title: 参考电极与接地电极（GND / BIAS）
short: 脑电测的是电压差；参考参与每个通道，BIAS 用于稳定共模，两者作用不同。
see: 多数通道同时变差或饱和，通常是头顶的参考电极或额头的接地电极没贴好
tip: 先让头顶的参考电极和额头的接地电极贴紧，再调其他电极
level: 入门
en: reference electrode and bias electrode
related: contact,floor,channel
---

## 原理

记录值可写成“测量电极电位 − 参考电极电位”。参考不是绝对零电位，也会含生理信号与噪声。参考接触变化可能让许多通道一起变化，重新参考也会改变波形与频谱。

BIAS 通常通过反馈帮助稳定人体相对于放大器的共模电位，作用不同于记录参考。本设备的接地电极（GND，接 BIAS）在额头中间偏上，参考电极在头顶。具体端子与接法以设备说明为准，不可把参考、BIAS 和保护接地随意互换。

## 图示

![电极皮肤等效电路](images/impedance.svg "接触界面的简化 RC 电路示意；阻抗随测试频率变化")

## 典型数值

| 项目 | 范围或解释 |
|---|---|
| 电压单位 | µV，必须说明参考方式 |
| 共同参考 | 可能在多个通道中引入相似成分 |
| 参考电极位置 | 本设备在头顶；头发多，需拨开头发贴紧 |

## 在本软件里

当前记录使用的参考接法需与设备配置核对。若多路同时变差，优先检查参考和 BIAS 的接触，再看单个头皮电极。

## 常见误区

> [!误区] 所有通道同步变化就是多个脑区一起活动
> 也可能是参考、共模干扰或运动造成，参见 [[floor]]。

## 参考

- Nunez P. L., Srinivasan R. Electric Fields of the Brain: The Neurophysics of EEG. Oxford University Press, 第 2 版, 2006.
- Sinha S. R. 等. [Minimum Technical Requirements for Performing Clinical Electroencephalography](https://scholarworks.indianapolis.iu.edu/items/8237ef7a-94e8-4bb1-8a0d-0dbd4033aa7a). Journal of Clinical Neurophysiology, 2016, 33:303–307. 本手册仅借鉴记录原理，不将软件视作临床设备。
