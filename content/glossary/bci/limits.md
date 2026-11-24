---
id: limits
title: 能做到什么，做不到什么
short: 本软件可以检验预先定义状态能否区分，不能凭颜色或评分诊断、读心或评价智力。
level: 入门
en: capabilities and limitations
related: artifact,validation
---

## 原理

“闭眼”和“睁眼”是可操作的实验条件，“专注”和“放松”则需要具体指令及外部行为证据。模型能够区分两个标签，并不证明识别到的是标签所声称的心理过程；它可能学到眼动、肌肉紧张或采集顺序。

可靠性需要在新的数据段、不同时间甚至重新佩戴后验证。离线表现、在线可用性和神经机制是三个不同问题。研究中的植入式语言解码也不能直接推及本软件的头皮记录能力。

## 图示

![实验记录与验证](images/data.svg "按独立数据段分组、保留元信息并留出测试数据的示意")

## 典型数值

| 项目 | 范围或解释 |
|---|---|
| 离线评价 | 保留未参与训练的数据 |
| 在线评价 | 记录成功次数、误触发次数与等待时间 |
| 跨天表现 | 通常需要复测，不能用一次结果承诺 |

## 在本软件里

先在「模型与输出」查看准确率与随机水平，再在触发规则预览中观察静息误触发。记录失败情况与成功情况同样重要。

## 常见误区

> [!误区] 模型分得开，就证明测到了专注或情绪
> 标签与信号相关还不足以证明心理含义，应排除动作、时序、设备漂移等替代解释。

## 参考

- Wolpaw J. R. 等. [Brain–computer interfaces for communication and control](https://pubmed.ncbi.nlm.nih.gov/12048038/). Clinical Neurophysiology, 2002, 113:767–791.
- Combrisson E., Jerbi K. [Exceeding chance level by chance: The caveat of theoretical chance levels in brain signal classification and statistical assessment of decoding accuracy](https://www.sciencedirect.com/science/article/pii/S0165027015000114). Journal of Neuroscience Methods, 2015, 250:126–136.
