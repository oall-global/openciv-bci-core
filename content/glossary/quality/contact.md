---
id: contact
title: 接触状态（正常 / 接触差 / 未接触）
short: 接触状态是按饱和等信号特征作出的筛查，需要结合阻抗、波形和实际佩戴判断。
see: 通道列表里的「正常 / 接触差 / 未接触」，以及头部示意图上的颜色
tip: 拨开头发并轻调接触，固定线缆，等待数秒稳定；不要强压电极
level: 入门
en: electrode contact screening
related: impedance,worn,artifact
---

## 原理

悬空或接触不稳常导致漂移、工频和量程占用升高。软件利用这些特征帮助定位可疑通道，但这是启发式判断，不是对电极与皮肤接触的直接视觉确认。

接触差可能暂时没有饱和，良好接触也可能因强干扰或偏置出现告警。若多通道一起变差，先检查参考、BIAS 和连接；若只有一通道异常，再检查该电极与头发、压力和线缆。

## 图示

![信号饱和](images/clipping.svg "理想输入与被截平记录的对照示意；丢失的峰值不能靠滤波还原")

## 典型数值

| 项目 | 范围或解释 |
|---|---|
| 当前量程筛查 | 约 75% 提示较差，90% 附近提示饱和风险 |
| 平直信号 | 可能为未接触、断流或输入异常，需结合其他信息 |
| 调整后等待 | 留出数秒让信号稳定，再看趋势 |

## 在本软件里

在「设备」及「接触诊断」中逐点查看。拨开头发、轻调接触并固定线缆；不要靠用力压紧追求绿色。

## 常见误区

> [!误区] 所有点变绿就保证可以做准确实验
> 状态正常只排除了部分问题，仍需排查伪迹、映射和数据丢失。

## 参考

- Sinha S. R. 等. [Minimum Technical Requirements for Performing Clinical Electroencephalography](https://scholarworks.indianapolis.iu.edu/items/8237ef7a-94e8-4bb1-8a0d-0dbd4033aa7a). Journal of Clinical Neurophysiology, 2016, 33:303–307. 本手册仅借鉴记录原理，不将软件视作临床设备。
