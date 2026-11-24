---
id: worn
title: 佩戴判断
short: 佩戴判断结合额头阻抗与持续信号状态；确认后建立基线，并非生理状态识别。
see: 「请戴上设备」→「初始化中（正在建立基线，n/30 秒）」→ 正常显示
tip: 戴好后保持放松，等 30 秒初始化完成
level: 进阶
en: wear detection and initialization
related: contact,baseline,impedance
---

## 原理

首次佩戴时，软件用 Fp1 的测试阻抗寻找可能的皮肤接触，再观察一段连续信号来确认。测试电流回路涉及接触电极，因此参考电极和对应接线都重要。

确认后建立基线。后续摘戴检测更多依赖多通道量程变化，这类规则可能误判；用户仍应核对真实佩戴和波形。用手触摸电极、潮湿环境或接线改变都不能作为严格的佩戴验证。

## 图示

![电极皮肤等效电路](images/impedance.svg "接触界面的简化 RC 电路示意；阻抗随测试频率变化")

## 典型数值

| 项目 | 范围或解释 |
|---|---|
| 首次阻抗条件 | 当前实现连续约 3 秒低于 2500 kΩ |
| 初始化窗口 | 约 30 秒，需同时满足稳定条件 |
| 摘下筛查 | 当前实现量程中位数约 90% 持续 4 秒；属软件规则 |

## 在本软件里

按照「佩戴校准」完成接触、基线和闭眼观察。卡在初始化时先看 Fp1、参考与 BIAS，不要反复重启掩盖接触问题。

## 常见误区

> [!误区] 判为已佩戴，就代表所有电极都记录良好
> 首次判断只确认有限条件，其他电极仍须逐个检查。

## 参考

- Sinha S. R. 等. [Minimum Technical Requirements for Performing Clinical Electroencephalography](https://scholarworks.indianapolis.iu.edu/items/8237ef7a-94e8-4bb1-8a0d-0dbd4033aa7a). Journal of Clinical Neurophysiology, 2016, 33:303–307. 本手册仅借鉴记录原理，不将软件视作临床设备。
