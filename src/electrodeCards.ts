// 电极卡片 (design/electrode-card): what each of the 16 electrodes lies over, what it is related
// to, which signals are usually read there and what can be built on them, each with how far it
// is (成熟 / 需训练 / 研究中 / 证据较弱). Written for the left electrode of each pair; the right
// one mirrors place, anatomy and function (左 ↔ 右), with its own text where the sides differ.
export type Readiness = '成熟' | '需训练' | '研究中' | '证据较弱';
export type ElectrodeCard = {
  place: string;
  anatomy: string;
  func: string;
  signals: string;
  abilities: [string, Readiness][];
  live: [string, string][]; // shown now: symbol, band id (brainHistory BANDS)
};

const LEFT: Record<string, ElectrodeCard> = {
  Fp1: {
    place: '左前额极',
    anatomy: '前额叶前部（额极）',
    func: '高级认知调控、计划与评估；离眼睛最近，眼电干扰最强',
    signals: '眨眼与垂直眼动的眼电（EOG）、前额 θ / α、额叶 α 不对称',
    abilities: [
      ['眨眼或注视作开关', '成熟'],
      ['作为伪迹参考，帮其他通道去除眼电', '成熟'],
      ['阅读时的眼动节奏分析', '研究中'],
    ],
    live: [
      ['θ', 'theta'],
      ['α', 'alpha'],
    ],
  },
  F7: {
    place: '左前额外侧',
    anatomy: '额下回附近，靠近布洛卡区（语言产出）',
    func: '语言加工（多在左侧）、情绪调节、工作记忆',
    signals: '水平眼动的眼电（向两侧看时 F7、F8 极性相反）、θ / β 节律、语言任务相关电位',
    abilities: [
      ['向两侧看来选择', '成熟'],
      ['视线方向粗估', '需训练'],
      ['默念或命名任务的两半球差异', '研究中'],
    ],
    live: [
      ['θ', 'theta'],
      ['β', 'beta'],
    ],
  },
  F3: {
    place: '左额区',
    anatomy: '背外侧前额叶（DLPFC）',
    func: '工作记忆、注意控制、任务切换、规则维持',
    signals: '额区 θ 随记忆负荷升高；额叶 α 不对称（与趋近 / 回避动机有关，有争议）',
    abilities: [
      ['工作记忆负荷实验（记 2 到 7 位数字）', '研究中'],
      ['任务难度与脑电对照', '研究中'],
      ['额叶 α 不对称记录', '证据较弱'],
    ],
    live: [
      ['θ', 'theta'],
      ['α', 'alpha'],
    ],
  },
  C3: {
    place: '左侧中央区',
    anatomy: '初级运动 / 感觉皮层（中央前回、中央后回）',
    func: '右侧肢体（尤其右手）的运动执行、运动准备与体感处理',
    signals:
      'μ 节律（8–13 Hz）、β 节律（13–30 Hz）；动作或运动想象时功率下降（ERD），结束后 β 反弹（ERS）',
    abilities: [
      ['运动想象：想象一只手动作，控制灯、光标或机械臂', '需训练'],
      ['动作意图检测：动作前约 1 秒的准备电位', '研究中'],
      ['动作观察：看别人动手时 μ 同样减弱', '研究中'],
    ],
    live: [
      ['μ', 'alpha'],
      ['β', 'beta'],
    ],
  },
  T7: {
    place: '左颞区',
    anatomy: '颞上回附近，听觉皮层；左侧参与语音理解',
    func: '听觉处理、语音感知、声音记忆',
    signals: '听觉诱发电位（N1、失匹配负波 MMN）、40 Hz 听觉稳态反应（ASSR）；咬牙时的颞肌肌电',
    abilities: [
      ['咬牙当按键', '成熟'],
      ['错音检测：一串声音里的异常音引出 MMN', '研究中'],
      ['听觉注意解码：判断你在听哪一侧的声音', '研究中'],
    ],
    live: [
      ['α', 'alpha'],
      ['γ', 'gamma'],
    ],
  },
  P3: {
    place: '左顶区',
    anatomy: '顶叶，空间注意与多感觉整合',
    func: '空间注意（「在哪里」）、目标检测、多感觉信息整合',
    signals: 'P300 的空间分布（Pz 常更关键，本布局没有 Pz）、注意一侧时的 α 偏侧化',
    abilities: [
      ['P300 选择器：选项依次闪亮，注视即选中', '成熟'],
      ['目标识别实验', '成熟'],
      ['隐蔽注意解码：眼睛不动，只把注意放到一侧', '研究中'],
    ],
    live: [
      ['α', 'alpha'],
      ['β', 'beta'],
    ],
  },
  P7: {
    place: '左后颞区',
    anatomy: '枕颞交界，靠近梭状回（面孔与物体识别）',
    func: '高级视觉识别：面孔、文字、物体类别',
    signals: 'N170（看到面孔后约 170 毫秒，右侧通常更强）、视觉类别相关电位',
    abilities: [
      ['面孔识别实验：人脸与房子图片的 N170 对比', '成熟'],
      ['脑搜图：每秒约 10 张图，脑电标出你在找的那张（RSVP）', '研究中'],
      ['熟悉与陌生面孔比较', '研究中'],
    ],
    live: [
      ['α', 'alpha'],
      ['θ', 'theta'],
    ],
  },
  O1: {
    place: '左枕区',
    anatomy: '初级视觉皮层及周边',
    func: '视觉信息的早期处理',
    signals:
      '闭眼 α 增强（1929 年 Berger 最早记录到的脑电节律）、视觉诱发电位（VEP）、稳态视觉诱发电位（SSVEP）',
    abilities: [
      ['闭眼开关', '成熟'],
      ['SSVEP 选择：注视哪个闪烁按钮就选哪个', '成熟'],
      ['SSVEP 拼写器：只用注视打字', '成熟'],
    ],
    live: [
      ['α', 'alpha'],
      ['β', 'beta'],
    ],
  },
};
const PAIRS: Record<string, string> = {
  Fp1: 'Fp2',
  F7: 'F8',
  F3: 'F4',
  C3: 'C4',
  T7: 'T8',
  P3: 'P4',
  P7: 'P8',
  O1: 'O2',
};
const swap = (s: string) => s.replace(/[左右]/g, (c) => (c === '左' ? '右' : '左'));
// where the right side is not the mirror of the left
const RIGHT: Record<string, Partial<ElectrodeCard>> = {
  F8: {
    anatomy: '额下回附近；右侧与语调、情绪加工有关',
    func: '语调与情绪加工、注意控制、工作记忆',
  },
  T8: { anatomy: '颞上回附近，听觉皮层；右侧参与音高与语调感知' },
};

export const ELECTRODE_CARDS: Record<string, ElectrodeCard> = Object.fromEntries(
  Object.entries(LEFT).flatMap(([l, c]) => {
    const r = PAIRS[l];
    return [
      [l, c],
      [
        r,
        {
          ...c,
          place: swap(c.place),
          anatomy: swap(c.anatomy),
          func: swap(c.func),
          ...RIGHT[r],
        },
      ],
    ];
  }),
);
