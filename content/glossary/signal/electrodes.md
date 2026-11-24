---
id: electrodes
title: 电极与位置名称（Fp1、O1…）
short: 电极名称描述头皮位置：奇数在左、偶数在右、z 在中线，位置不等同于单独脑区。
level: 入门
en: 10–20 electrode system
related: channel,anatomy,reference
---

## 原理

10–20 系统以鼻根、枕外隆凸和耳前点等标志按头部距离的比例安排位置。Fp、F、C、P、O、T 分别提示前额、额、中央、顶、枕与颞部；C 是中央位置，不是一个叫“中央叶”的脑叶。

默认 16 点布局只是软件的通道映射。戴法、导线顺序或设置改变后，必须同步更新映射。左右均以佩戴者自身为准，俯视图鼻尖在上。位置只提供粗略解剖参照，不保证信号来自正下方。

## 图示

![默认 16 电极布局](images/electrodes.svg "俯视头部、鼻尖朝上；位置为示意，必须与实际接线核对")

## 典型数值

| 项目 | 范围或解释 |
|---|---|
| 默认点位数 | 16，不包含所有标准 10–20 位置 |
| 旧名与新名 | T3/T4 对应 T7/T8，T5/T6 对应 P7/P8 |
| z | 中线，例如 Fz、Cz、Pz，并非默认一定有这些通道 |

## 在本软件里

到「设置 → 电极位置」逐项核对 CH1–CH16 与真实接线。默认顺序和图中的名称对应；自定义后以实际配置为准。

## 常见误区

> [!误区] O1 永远是某个固定编号的插孔
> O1 是头皮位置，CH 编号是设备输入，两者靠接线和配置建立对应关系。

## 参考

- Sinha S. R. 等. [Minimum Technical Requirements for Performing Clinical Electroencephalography](https://scholarworks.indianapolis.iu.edu/items/8237ef7a-94e8-4bb1-8a0d-0dbd4033aa7a). Journal of Clinical Neurophysiology, 2016, 33:303–307. 本手册仅借鉴记录原理，不将软件视作临床设备。
- Nunez P. L., Srinivasan R. Electric Fields of the Brain: The Neurophysics of EEG. Oxford University Press, 第 2 版, 2006.
