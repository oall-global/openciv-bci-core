---
id: mind-reading
title: 能不能读出我在想什么？
short: 本软件不能直接读出自由想法、记忆或内心语言；分类输出只针对已定义条件。
level: 入门
en: limits of mental-content decoding
related: limits,consent
---

## 原理

任务模型接收有限通道的混合信号，并在给定标签中选出相似的一类。即使标签叫“同意”，也只表示当前特征更接近训练时标为“同意”的样本，不表示系统理解了具体语义。

研究中的语言或图像解码通常依赖特定设备、大量训练和受限任务。不能把那些条件下的结果外推到当前头皮设备，也不能将一次成功演示用于判断他人的真实意愿。

## 图示

![脑机接口处理流程](images/pipeline.svg "从采集到输出的流程示意；每一步都可能引入误差")

## 典型数值

| 项目 | 范围或解释 |
|---|---|
| 输出集合 | 由预先定义的任务标签限制 |
| 自由语义 | 当前软件没有自由思想转写能力 |
| 同意确认 | 需使用者明确确认，不能仅以模型标签替代 |

## 在本软件里

为任务选择具体、可操作的状态名称，向参与者解释评分含义。控制需要确认的操作时保留人工确认方式。

## 常见误区

> [!误区] 把状态名字改成一句话，模型就能检测这句话
> 名称只是一条标签，不会赋予模型新的语义读取能力。

## 参考

- Wolpaw J. R. 等. [Brain–computer interfaces for communication and control](https://pubmed.ncbi.nlm.nih.gov/12048038/). Clinical Neurophysiology, 2002, 113:767–791.
- Yuste R. 等. [Four ethical priorities for neurotechnologies and AI](https://www.nature.com/articles/551159a). Nature, 2017, 551:159–163.
