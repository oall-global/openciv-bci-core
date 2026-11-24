# 任务会话数据格式 · v1

每完成（或中止）一次探索任务，NeuroLink 都会在本机保存一个会话目录。格式以"不用 NeuroLink 也能读"为原则：CSV 和 JSON，可以直接用 Excel、pandas 或 MNE 打开。

## 位置

```
%APPDATA%\neurolink-desktop\sessions\<会话编号>\
```

会话编号为 `YYYYMMDD-HHMMSS-<任务编号>`，例如 `20260923-153012-blink`。任务首页「我的记录」中可以打开文件夹或删除。数据不会上传。

## 文件

| 文件 | 内容 |
|---|---|
| `session.json` | 会话信息：任务、状态、软件版本、设备、电极、参数、佩戴检查、样本数、传输统计、结果摘要 |
| `eeg.csv` | 原始脑电，每行一个样本 |
| `events.jsonl` | 任务事件，每行一个 JSON |
| `quality.jsonl` | 每秒一次的信号质量快照 |
| `results.json` | 任务完整结果（仅完成的会话有） |

### session.json

| 字段 | 说明 |
|---|---|
| `format` / `version` | 固定为 `neurolink-session` / `2`（版本 1 见文末） |
| `status` | `completed` 完成；`aborted` 中止（信号中断、用户停止、离开页面等），此时 `abortReason` 说明原因且没有 `results.json` |
| `task` | 任务编号、版本、名称 |
| `source` | `device` 真实设备；`demo` 模拟数据 |
| `device` | 板型编号、采样率 `rate`、单位 `unit`（µV）、电极布局 |
| `electrodes` | 16 个通道对应的电极位置，顺序与 `eeg.csv` 列顺序一致 |
| `channelsUsed` | 本任务主要使用的电极 |
| `params` | 任务参数 |
| `fit` | 开始前的佩戴检查结果（当前为饱和检查，不是阻抗） |
| `samples` / `durationSeconds` | 样本总数与时长 |
| `transport` | 会话期间按设备样本序号估计的缺失、重复与不确定跳变次数 |
| `results` | 结果摘要，含 `headline`（给用户看的一句话） |
| `timing` | 事件对齐方式的说明 |
| `gaps` / `gapCount` | 采集时间轴上的缺口：`{sample, lost}`，`sample` 是缺口后第一行的序号，`lost` 是丢失的样本数；`lost` 为 `null` 表示样本计数重新开始（时间倒退或跳过 10 秒以上），前后的时间关系不可靠。最多列出 1000 个 |
| `quality` | 各通道在录制期间饱和（`railed`）、接近饱和（`near`）、信号不变（`flat`）的秒数占比，`seconds` 为统计的秒数；逐秒记录见 `quality.jsonl` |

### eeg.csv

```
sample,timestamp,package,Fp1,Fp2,C3,C4,P7,P8,O1,O2,F7,F8,F3,F4,T7,T8,P3,P4,received
0,1790000000.123456,17,-12.345,...,1790000002.301002
```

- `sample`：会话内样本序号，从 0 开始。
- `timestamp`：该样本的**采集时间**：设备测量它的时刻，换算到主机时钟（Unix 秒）。由设备样本计数推算，见下文「时间与对齐」。
- `package`：设备样本序号（0–255 循环），可用于检查缺样。
- 其余 16 列：各电极电压，单位 µV，未滤波（含直流偏移，分析前需要高通或带通滤波）。
- `received`：主机收到该样本的时间（BrainFlow 时间戳）。`received − timestamp` 就是传输延迟。
- 电极布局与 OpenBCI GUI 默认 16 通道布局一致。
- 传输中丢失的样本不补行；丢失数量见 `session.json` 的 `clock.lostSamples`。

### events.jsonl

```json
{"t":1790000003.512,"label":"cue.blink","source":"instruction","data":{"phase":"calibration","index":1},"sample":845}
```

- `t`：事件发生时的主机时间（Unix 秒）。
- `label`：事件名称。常见前缀：`cue.*` 提示出现，`cond.*.start/end` 条件段，`detected.*` 系统识别到动作，`baseline.*` 基线阶段。
- `source`：标签的来源，决定它能不能当作训练的真实标签：

  | 值 | 含义 | 来自 |
  |---|---|---|
  | `instruction` | 软件提示被试去做（提示、条件段） | `cond.*` `cue.*` `baseline.*` `stim.*` `trial.*` |
  | `observed` | 独立观察到的实际动作 | 暂无 |
  | `manual` | 人工标记 | `marker` |
  | `prediction` | 模型或检测器识别的结果，**不是真实标签** | `control.*` `select.*` `detected.*` |
  | `command` | 发给设备的指令 | 暂无 |
  | `unknown` | 未记录 | 其他 |

  没有 `source` 的旧会话，导出时按上表从 `label` 推断。
- `data`：事件附加信息。
- `sample`：对齐到 `eeg.csv` 的样本序号，即**采集时间不早于 `t` 的第一个样本**。落在数据范围外时为 `null`。

### 时间与对齐

- **问题**：BrainFlow 给样本打的是主机**收到**的时间。Wi-Fi 模块成批发送，而且会积压：
  - 一次 6 分钟的真实录制中，延迟在前两分钟从 0 逐步涨到 3.4 秒；
  - 版本 1 按收到时间对齐事件，事件因此错开了几秒。
- **做法**（`engine/acqclock.py`）：设备按固定频率采样，所以第 k 个样本的采集时间 = A + k·(1 + d)/rate。
  - k 从连接开始计数，按 `package` 补上丢失的样本。
  - d 是设备时钟相对主机时钟的偏差。实测本设备约 800–1100 ppm，也就是实际采样率约 249.8 Hz。
  - A 和 d 都从"收到时间 − 名义采集时间"的下包络线估计：样本不可能早于采集时刻到达，最快到达的那些样本最接近真实时间。延迟的阶梯式上升会被识别出来并排除。
  - 连接后 30 秒起估计 d，此后每 10 秒更新一次。
- **精度**：
  - 模拟 Wi-Fi 积压（6 分钟，延迟阶梯式上升到 3.3 秒，时钟偏差 870 ppm）：30 秒后误差 ≤ 10 ms，主要来自不可观测的最小传输延迟；
  - 对真实录制事后重算，与在线估计相差 ≤ 4 ms。
- **会话结束**：结束时会等延迟中的数据到齐（最多 15 秒），再写入文件，末尾的事件和数据不会被截掉。
- **事件时间 `t`**：视觉提示取的是新画面真正显示的那一帧（状态更新后第二个动画帧）。显示器本身的延迟仍然存在，没有用光电传感器验证。
- **传输延迟本身**不影响录下的数据，但会让实时反馈、控制和游戏变慢。延迟超过 0.5 秒时，任务页和控制页会提示。

`session.json` 的 `clock` 字段：

| 字段 | 含义 |
|---|---|
| `driftPpm` | 估计的设备时钟偏差 |
| `latencyMax` / `latencyEnd` | 本次最大 / 结束时的传输延迟（秒） |
| `lostSamples` | 本次传输中丢失的样本数 |
| `restarts` | 样本计数中断、时钟重新开始的次数；大于 0 时，中断前后的时间关系不可靠 |

### 版本 1（NeuroLink ≤ 0.1.31）

- 版本 1 的 `timestamp` 是收到时间，事件按收到时间对齐，Wi-Fi 积压时会错开几秒。
- 用 `engine/realign.py` 可以把它转成版本 2：
  - `eeg.csv` 的 `timestamp` 改为采集时间，原值移到 `received` 列；
  - 事件重新对齐，原文件保留为 `events.v1.jsonl`；
  - 旧的 `analysis.json` 改名为 `analysis.v1.json`；
  - `session.json` 的 `clock.realigned` 记录了这次修改。
- 局限：事后重算以该会话内延迟最小的时刻为基准。如果会话开始前延迟就已经积压，会残留一个固定偏移。

### quality.jsonl

```json
{"t":1790000004.001,"sample":1000,"rail":["normal","normal",...]}
```

每秒一次，记录 16 个通道的饱和检查状态：`normal` 未饱和，`near` 接近饱和，`railed` 已饱和，`flat` 信号不变，`unknown` 无数据。

## 读取示例

### pandas

```python
import json, os, pandas as pd
from pathlib import Path

d = Path(os.path.expandvars(r"%APPDATA%\neurolink-desktop\sessions\20260923-153012-blink"))
info = json.loads((d / "session.json").read_text(encoding="utf-8"))
eeg = pd.read_csv(d / "eeg.csv")
events = pd.read_json(d / "events.jsonl", lines=True)
print(info["status"], info["device"]["rate"], len(eeg))
```

### MNE

```python
import mne, numpy as np

rate = info["device"]["rate"]
data = eeg[info["electrodes"]].to_numpy().T * 1e-6  # µV → V
raw = mne.io.RawArray(data, mne.create_info(info["electrodes"], rate, "eeg"))
raw.set_montage("standard_1020")  # MNE 1.13 起提示改名为 "colin27_1020"
cues = events[events.label.str.startswith("cue.") & events["sample"].notna()]
raw.set_annotations(mne.Annotations(cues["sample"] / rate, 0.0, cues.label.tolist()))
```

## 被试

每个会话记录一个被试代号（`session.json` 的 `participant.code`），以及该被试确认数据说明的版本和时间（`participant.consent`）。代号只允许字母和数字，不记录姓名，同时用作 BIDS 的 `sub-` 标签。被试列表保存在 `%APPDATA%\neurolink-desktop\participants.json`。数据说明更新后，旧的确认失效，会重新询问。

## 导出

在「我的记录」中：

- **导出 BDF**（每条记录）：BDF+C 格式，24 位，16 个 EEG 通道按电极命名，单位 µV，物理量程 ±187500 µV（ADS1299 在增益 24 时的满量程），分辨率约 0.022 µV。事件写入 `BDF Annotations` 通道，时间取自 `events.jsonl` 的 `sample`。
- **导出 BIDS 数据集**：包含所有已完成的会话，结构为 `sub-<代号>/ses-<日期时间>/eeg/`，每个会话有 `_eeg.bdf`、`_eeg.json`、`_channels.tsv`、`_events.tsv`、`_events.json`，根目录有 `dataset_description.json`、`participants.tsv`、`README`，`sourcedata/sub-<代号>/ses-<日期时间>/` 是原始会话文件（含收到时间和设备样本序号，便于追溯）。`PowerLineFrequency` 固定为 50 Hz。
  - `_events.tsv` 多一列 `source`（见上文 events.jsonl），含义写在 `_events.json`。
  - `_channels.tsv` 的 `status`：录制中一半以上的秒数饱和或信号不变的通道为 `bad`，`status_description` 写明比例。

两种导出的共同做法：

- **缺失的样本**：传输中丢失的样本在文件里补 0 占位，并标记 `BAD_gap`（时长为丢失的时长），之后的样本和事件保持原来的时间；样本计数重新开始处标记 `BAD_discontinuity`。不插值。BIDS 的 `_eeg.json` 记录补了多少样本（`openciv_bci_filled_samples`）。
- **末尾**：BDF 以 1 秒为一个数据记录，末尾不足 1 秒的部分补 0 并标记 `BAD_padding`，数据和事件都不丢。
- 分析和训练时应排除 `BAD_*` 段。
- 已用 MNE 1.13（`read_raw_bdf`）和 MNE-BIDS 0.20（`read_raw_bids`）读取验证：数值、`BAD_*` 标记和坏通道都能读出；官方 BIDS Validator（bids-validator-deno）检查无错误，只有推荐字段的提示（作者、头围、硬件滤波等未知信息不填）。

## 工作台录制与事件标记

- 信号工作台的「开始录制」会同时产生两份数据：用户选择位置的 `.neuro.jsonl`（含频谱等计算结果，用于工作台回放），以及一个任务编号为 `free-recording` 的会话（本格式，可导出 BDF / BIDS）。会话的 `params.replayFile` 记录对应的回放文件名。录制需要已确认数据说明的被试。
- 有会话进行时（探索任务或自由录制），工作台「事件标记」和开发者接口写入的标记都会记入会话事件：`label` 为 `marker`，文字在 `data.text`，`data.client` 为来源，`data.clientTimestampMs` 为客户端自报时间（仅供参考）。对齐使用主机收到标记的时间。
