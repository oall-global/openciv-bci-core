---
id: formats
title: 文件格式与元信息
short: 数据文件必须与采样率、通道顺序、参考、单位、时间戳和事件一起保存才可解释。
level: 进阶
en: recording formats and metadata
related: privacy,channel
---

## 原理

CSV 方便检查表格数据，但格式本身不规定单位、采样率或事件含义。JSON 适合保存元信息，JSONL 逐行保存结构化记录。文件扩展名不能保证内容符合某个脑电交换标准。

事件应明确使用设备时间还是电脑时间，样本索引从哪里开始，断流如何表示。导出后用一小段核对点数、时间跨度、单位与通道，避免在其他软件中把 µV 当成 V 或把缺失点拼接为连续数据。

## 图示

![实验记录与验证](images/data.svg "按独立数据段分组、保留元信息并留出测试数据的示意")

## 典型数值

| 项目 | 范围或解释 |
|---|---|
| 研究导出 | 查看所选导出中的 CSV 与伴随元信息 |
| 脑电时刻 | 当前录制使用 .neuro.jsonl；不是通用临床文件格式 |
| 模型 | 当前桌面实现以 JSON 等本机文件保存 |
| 必留字段 | 采样率、通道、参考、单位、时间基准、事件及处理历史 |

## 在本软件里

在记录或脑电时刻页面导出后保留整套相关文件。导入其他分析工具前先读格式说明，不要通过改扩展名假装转换格式。

## 常见误区

> [!误区] 有 16 列数字就足以复现实验
> 没有位置、参考、单位和标签时，很多解释无法恢复。

## 参考

- Cohen M. X. Analyzing Neural Time Series Data: Theory and Practice. MIT Press, 2014.
- Sinha S. R. 等. [Minimum Technical Requirements for Performing Clinical Electroencephalography](https://scholarworks.indianapolis.iu.edu/items/8237ef7a-94e8-4bb1-8a0d-0dbd4033aa7a). Journal of Clinical Neurophysiology, 2016, 33:303–307. 本手册仅借鉴记录原理，不将软件视作临床设备。
