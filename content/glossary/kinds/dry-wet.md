---
id: dry-wet
title: 干电极与湿电极
short: 干、湿电极改变的是皮肤接触条件；信号质量还取决于阻抗平衡、放大器与动作。
level: 进阶
en: dry and wet electrodes
related: impedance,contact,reference
---

## 原理

湿电极通过电解质改善电极与皮肤的耦合；干电极依靠材料、形状与压力直接接触。头发、皮肤油脂、出汗和移动都会影响界面。干电极更方便，但不代表可以忽略接触检查。

阻抗不是越低越值得不惜代价追求：过度按压或磨擦皮肤不可取。放大器输入阻抗、各电极间的不平衡及线缆晃动，也会决定记录是否受工频和动作污染。

## 图示

![电极皮肤等效电路](images/impedance.svg "接触界面的简化 RC 电路示意；阻抗随测试频率变化")

## 典型数值

| 项目 | 范围或解释 |
|---|---|
| 湿电极常见目标 | 传统记录常要求约 5–10 kΩ，依设备规范 |
| 干电极 | 可在数十至数百 kΩ 或更高范围工作，依系统而定 |
| 本软件分档 | 750、2500 kΩ 为当前实现阈值，不是通用医学标准 |

## 在本软件里

在「设备」及接触检查中逐个观察，先排查头顶的参考电极，再调整其他电极。软件分档见 [[impedance]]，不要照搬到别的设备。

## 常见误区

> [!误区] 湿电极必然干净，干电极必然不可用
> 两者均可能采到好数据或坏数据，需结合实际波形和频谱评价。

## 参考

- Sinha S. R. 等. [Minimum Technical Requirements for Performing Clinical Electroencephalography](https://scholarworks.indianapolis.iu.edu/items/8237ef7a-94e8-4bb1-8a0d-0dbd4033aa7a). Journal of Clinical Neurophysiology, 2016, 33:303–307. 本手册仅借鉴记录原理，不将软件视作临床设备。
