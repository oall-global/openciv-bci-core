---
id: validation
title: 数据量、验证与信息泄漏
short: 训练数据用于学习，独立测试用于判断能否推广；同一段的重叠窗不能散落两边。
level: 进阶
en: validation, leakage and reproducibility
related: 
---

## 原理

把同一原始段切成许多窗后随机分训练和测试，会让两边共享近乎相同的信号。模型也可能记住会话漂移。应按独立段或会话分组，并把标准化、通道选择和调参放在训练侧。

交叉验证用于估计表现，最终还应保留新数据检验选择后的模型。反复看测试结果再修改方案，会逐渐把测试集变成训练的一部分。类别比例、错误类型与静息误触发也需报告。

## 图示

![实验记录与验证](images/data.svg "按独立数据段分组、保留元信息并留出测试数据的示意")

## 典型数值

| 项目 | 范围或解释 |
|---|---|
| 独立单位 | 数据段、会话或参与者，依推广目标确定 |
| 按段验证 | 检验新段，不能自动证明跨天或跨人有效 |
| 多次尝试 | 需记录候选数量及选择过程 |
| 在线指标 | 成功率、每分钟误触发、延迟与停机率 |

## 在本软件里

查看「模型与输出」评价说明。用后续新一轮采集做复测，保持标签定义一致；若要证明跨天适用，应留出整天或整次佩戴的数据。

## 常见误区

> [!误区] 随机打乱所有窗口是最公平的验证
> 共享原始信号的窗口会造成泄漏，验证分组应匹配真实使用条件。

## 参考

- Combrisson E., Jerbi K. [Exceeding chance level by chance: The caveat of theoretical chance levels in brain signal classification and statistical assessment of decoding accuracy](https://www.sciencedirect.com/science/article/pii/S0165027015000114). Journal of Neuroscience Methods, 2015, 250:126–136.
- Cohen M. X. Analyzing Neural Time Series Data: Theory and Practice. MIT Press, 2014.
