// The 「?」 of the guided flows (首次打开 and 添加能力): only where one hesitates — why this step,
// what a number means, what to do when stuck. At most three parts, under 80 characters of body;
// 了解更多 opens the 概念手册 entry. Plain words; where a signal comes from muscles or the eyes,
// it says so.
export type StepNote = {
  title: string;
  why?: string;
  how?: string[];
  trouble?: string[];
  more?: string; // 概念手册 entry id
};

export const NOTES: Record<string, StepNote> = {
  // 信号工作台 · 电极卡片
  electrode: {
    title: '读这张卡片时',
    why: '头皮上测到的是许多脑区电活动的叠加；一个电极的变化，不等于它正下方皮层的精确激活。',
    how: ['同一节律在不同脑区、不同任务下含义不同。', '本布局没有 Fz、Cz、Pz 中线电极。'],
    trouble: ['闪烁刺激可能诱发光敏反应，有相关病史者不要做。'],
    more: 'electrodes',
  },
  // 信号工作台 · 接口
  api: {
    title: '开发者接口',
    why: '开启后，这台电脑上的其他程序可以读取实时脑电、频段能量和能力事件，用来做自己的应用。',
    how: [
      '地址 ws://127.0.0.1:8765，只接受本机连接，格式为 JSON / WebSocket。',
      '点「接口说明」查看地址、密钥和示例，「复制文本」交给你的程序或 AI 助手。',
      '每次开启生成新密钥；退出应用后接口关闭。',
    ],
    trouble: ['密钥只交给你信任的本机程序。'],
  },
  // 首次打开
  data: {
    title: '数据去哪里',
    why: '脑电只保存在这台电脑上，不上传、不同步。',
    how: ['之后可以在「脑电数据库」里查看、导出和删除。'],
    more: 'privacy',
  },
  usbMissing: {
    title: '找不到设备',
    trouble: [
      '确认指示灯亮绿色。',
      '换一根能传数据的线（有些线只能充电）。',
      '换一个 USB 口再试。',
      '关闭串口助手、烧录工具等可能占用设备的程序。',
    ],
  },
  deviceMissing: {
    title: '找不到设备',
    trouble: [
      '确认指示灯亮绿色。',
      '长按设备按键 3 秒，设备会重新打开自己的热点。',
      '让电脑靠近设备。',
      '台式机没有无线网卡时，请用 USB 连接。',
    ],
  },
  wifi: {
    title: '为什么用 Wi‑Fi',
    why: '佩戴时不连线，活动更自由，也不会把电脑电源的干扰带进信号。',
    how: [
      '密码只发给设备，App 不保存。',
      '设置时电脑会暂时连到设备的热点，完成后自动切回原来的 Wi‑Fi。',
    ],
    trouble: ['设备和电脑要连在同一个 Wi‑Fi 上。', '设备只能连 2.4 GHz 的 Wi‑Fi。'],
  },
  wear: {
    title: '为什么先戴这两个',
    why: '每个电极测的都是它和头顶参考电极之间的电压差；额头的接地电极压低外界干扰。这两个没贴好，其他电极都不准。',
    how: ['拨开头发，让电极碰到头皮。', '轻轻压一下再松开。'],
    trouble: [
      '电极一直是黄色或红色：调整它，等几秒再看。',
      '大部分电极同时是红色：多半是参考或接地电极没贴好，先调整这两个。',
    ],
    more: 'wearing',
  },
  rest: {
    title: '为什么要放松',
    why: '先记下你平静时的脑电，作为「平常的样子」，之后的变化都和它比。',
    how: ['坐稳，不说话。', '少眨眼，不咬牙。'],
    more: 'baseline',
  },
  closed: {
    title: '为什么闭眼',
    why: '闭眼放松时，后脑会出现明显的 α 节律（约 8–13 Hz）。这是最容易看到的脑电变化，能确认设备在正常工作。',
    more: 'alpha',
  },
  lamp: {
    title: '能用什么灯',
    why: '支持 Matter 的智能灯，插上电就能在这里添加。',
    how: ['没有灯也可以跳过，用屏幕上的光环代替，以后再添加。'],
    more: 'outputs',
  },
  charge: {
    title: '在测什么',
    why: '集中注意力看着一个东西时，后脑的 α 节律常会减弱；比放松时减弱得越多，灯越亮。测的是这个节律的变化，不是你的想法。',
    trouble: ['盯住灯，别闭眼，别走神。', '多试几次，每个人都不一样。'],
    more: 'alpha',
  },

  // 添加能力
  ways: {
    title: '想象和动作有什么不同',
    why: '「用想象」靠大脑自身的变化，需要练习，认准的程度因人而异；「用动作」靠眼睛和面部肌肉的电信号，更容易认准，但要真的做出动作。',
    how: ['不知道选哪个：先试「用动作」里的「闭上眼睛」或「咬一下牙」。'],
    more: 'collect',
  },
  own: {
    title: '怎么选',
    how: ['选一个能反复做、每次都差不多的。', '越具体越好：「想象跳进冷水里」比「想点别的」好。'],
  },
  practice: {
    title: '为什么要交替',
    why: 'App 对比你「在做这件事」和「在放松」时的差别，才能学会分辨。次数太少，学不准。',
    how: ['每次都用同样的方式。', '别的地方尽量不动。'],
    more: 'collect',
  },
  // 能力页 · 数据采集
  collectCount: {
    title: '要采集多少',
    why: '每种状态至少 3 段才能训练，建议 10 段以上。',
    how: ['新数据与已有数据合并训练。'],
    more: 'collect',
  },
  // 能力页 · 能力设置
  statesLocked: {
    title: '为什么不能改',
    why: '已采集的数据按状态名称标注，所以有数据时不能修改状态名称和数量。',
    how: ['如需修改，请先清空数据。'],
    more: 'states',
  },
  // 实验 · 专注小球
  focus: {
    title: '专注度怎么算',
    why: '用额头到头顶电极的 β ÷（α + θ）估计，高低只相对你自己最近一分钟而言，不是测评分数。',
    trouble: ['咬牙、皱眉会让它虚高，检测到时小球暂停。'],
  },
  // 脑电数据库 · 片段播放
  replayBands: {
    title: '这些比例是什么',
    why: '各节律占 1–40 Hz 总能量的比例，所有电极合计。',
    more: 'bands',
  },
  accuracy: {
    title: '这个数字是什么',
    why: '用没参加学习的那几次来测，App 认对的比例。随机水平是瞎猜也能达到的比例，要明显高于它才算学会了。',
    trouble: ['还认不准：再练一轮，或换一种更不一样的想象或动作。'],
    more: 'accuracy',
  },
};
