---
id: channel
title: 通道
short: 通道是一路电压差记录；通道编号、电极位置和参考方式必须一起看。
level: 进阶
en: recording channel and montage
related: electrodes,reference,formats
---

## 原理

一路通道通常表示一个测量电极与参考之间的电压差。多个通道可以共享参考，因而彼此不完全独立。导联或 montage 描述各记录如何由电极信号组合而成。

导出数据时只保留 CH 编号而丢失位置与参考信息，会使后续分析难以解释。通道失效也不能靠给它换个名称解决；应保留坏通道说明，避免将插值数据误写成实测。

## 图示

![默认 16 电极布局](images/electrodes.svg "俯视头部、鼻尖朝上；位置为示意，必须与实际接线核对")

## 典型数值

| 项目 | 范围或解释 |
|---|---|
| 默认采集通道 | 16 路，按当前设备和配置核对 |
| 通道编号 | CH1…CH16 描述输入顺序 |
| 位置名称 | Fp1、C3、O1 等描述头皮位置 |

## 在本软件里

用「设置 → 电极位置」核对映射，在「信号工作台」逐通道看波形。记录实验时同时保存顺序、参考与采样率，见 [[formats]]。

## 常见误区

> [!误区] 通道越多，所有信息就一定越准确
> 错误位置、接触不良和共同参考污染不会因为通道增多自动消失。

## 参考

- Sinha S. R. 等. [Minimum Technical Requirements for Performing Clinical Electroencephalography](https://scholarworks.indianapolis.iu.edu/items/8237ef7a-94e8-4bb1-8a0d-0dbd4033aa7a). Journal of Clinical Neurophysiology, 2016, 33:303–307. 本手册仅借鉴记录原理，不将软件视作临床设备。
