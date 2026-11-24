---
id: reading
title: 参考资料
short: 按问题选择资料：先读信号与术语，再读范式、处理、验证和伦理。
level: 进阶
en: references and further reading
related: terminology,validation
---

## 原理

本手册将通用生理概念、软件实现和示意数值分别标明。正文的参考用于追溯方法；某篇临床教材被引用，并不使本软件成为临床系统。引用结果也不能脱离原研究的人群、任务和设备条件。

阅读时先确认论文研究的是什么信号、使用何种参考和统计单位，再看结论。经典论文有历史价值，具体实现仍应核对当前方法与本软件的实际代码。

## 图示

![脑机接口处理流程](images/pipeline.svg "从采集到输出的流程示意；每一步都可能引入误差")

## 典型数值

| 项目 | 范围或解释 |
|---|---|
| 入门路线 | 脑电来源 → 电极与伪迹 → 频谱与基线 |
| 方法路线 | 范式 → 独立验证 → 在线控制 |
| 实现说明 | 本版内容按当前项目代码核对，参数随版本可能变化 |

## 在本软件里

使用手册搜索查中英文术语，再打开各条目文献。网页需联网；仅阅读引用不需要上传自己的脑电。

## 常见误区

> [!误区] 有参考文献就代表文中每个软件数值都是通用标准
> 软件阈值和示意算例应分别说明，不能借文献名义推广。

## 参考

- Berger H. [Über das Elektrenkephalogramm des Menschen](https://link.springer.com/article/10.1007/BF01814740). Archiv für Psychiatrie und Nervenkrankheiten, 1929, 87:527–570.
- Vidal J. J. [Toward Direct Brain-Computer Communication](https://www.annualreviews.org/content/journals/10.1146/annurev.bb.02.060173.001105). Annual Review of Biophysics and Bioengineering, 1973, 2:157–180.
- Wolpaw J. R. 等. [Brain–computer interfaces for communication and control](https://pubmed.ncbi.nlm.nih.gov/12048038/). Clinical Neurophysiology, 2002, 113:767–791.
- Buzsáki G., Anastassiou C. A., Koch C. [The origin of extracellular fields and currents—EEG, ECoG, LFP and spikes](https://pubmed.ncbi.nlm.nih.gov/22595786/). Nature Reviews Neuroscience, 2012, 13:407–420.
- Pfurtscheller G., Lopes da Silva F. H. [Event-related EEG/MEG synchronization and desynchronization: basic principles](https://pubmed.ncbi.nlm.nih.gov/10576479/). Clinical Neurophysiology, 1999, 110:1842–1857.
- Kane N. 等. [A revised glossary of terms most commonly used by clinical electroencephalographers… Revision 2017](https://pubmed.ncbi.nlm.nih.gov/30214992/). Clinical Neurophysiology Practice, 2017, 2:170–185.
- Widmann A., Schröger E., Maess B. [Digital filter design for electrophysiological data—a practical approach](https://home.uni-leipzig.de/biocog/eprints/widmann_a2015jneuroscimeth250_34.pdf). Journal of Neuroscience Methods, 2015, 250:34–46.
- Combrisson E., Jerbi K. [Exceeding chance level by chance: The caveat of theoretical chance levels in brain signal classification and statistical assessment of decoding accuracy](https://www.sciencedirect.com/science/article/pii/S0165027015000114). Journal of Neuroscience Methods, 2015, 250:126–136.
- Sinha S. R. 等. [Minimum Technical Requirements for Performing Clinical Electroencephalography](https://scholarworks.indianapolis.iu.edu/items/8237ef7a-94e8-4bb1-8a0d-0dbd4033aa7a). Journal of Clinical Neurophysiology, 2016, 33:303–307. 本手册仅借鉴记录原理，不将软件视作临床设备。
- Yuste R. 等. [Four ethical priorities for neurotechnologies and AI](https://www.nature.com/articles/551159a). Nature, 2017, 551:159–163.
- Nunez P. L., Srinivasan R. Electric Fields of the Brain: The Neurophysics of EEG. Oxford University Press, 第 2 版, 2006.
- Cohen M. X. Analyzing Neural Time Series Data: Theory and Practice. MIT Press, 2014.
- Britton J. W. 等. [The Normal EEG](https://www.ncbi.nlm.nih.gov/books/NBK390343/). Electroencephalography: An Introductory Text and Atlas, 2016.
