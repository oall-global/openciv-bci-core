---
id: impedance
title: 阻抗（kΩ）
short: 阻抗描述交流测试信号通过电极皮肤界面的难易程度，不只是一个直流电阻。
level: 专业
en: electrode–skin impedance
related: dry-wet,contact,reference
---

## 原理

皮肤和电极界面同时具有电阻与电容性质，所以阻抗依赖频率。测试以已知微小电流估算电压响应，换算得到 kΩ 数值；测试频率、幅度与算法改变时，数值也可能改变。

高阻抗和通道间不平衡常增加干扰风险，但不能单凭阻抗给出脑电质量结论。还要看放大器输入特性、噪声与移动。软件的颜色阈值是当前设备流程的设置，不是通用标准。

## 图示

![电极皮肤等效电路](images/impedance.svg "接触界面的简化 RC 电路示意；阻抗随测试频率变化")

## 典型数值

| 项目 | 范围或解释 |
|---|---|
| 测试电流 | 当前实现使用约 6 nA 的设备测试配置 |
| 软件绿色 | 低于 750 kΩ |
| 软件橙色 | 750–2500 kΩ |
| 软件需调整 | 高于 2500 kΩ；不得据此自行增大测试电流 |

## 在本软件里

在阻抗检查时按界面提示逐路测量。正在注入测试信号的通道不应用于正常脑电解释或模型训练；测完等稳定再开始实验。

## 常见误区

> [!误区] 阻抗越低就一定测得越准
> 各通道平衡、参考、运动和噪声同样重要；不要损伤皮肤来追求某个数值。

## 参考

- Sinha S. R. 等. [Minimum Technical Requirements for Performing Clinical Electroencephalography](https://scholarworks.indianapolis.iu.edu/items/8237ef7a-94e8-4bb1-8a0d-0dbd4033aa7a). Journal of Clinical Neurophysiology, 2016, 33:303–307. 本手册仅借鉴记录原理，不将软件视作临床设备。
