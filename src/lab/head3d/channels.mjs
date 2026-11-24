// Supplied Brain Lab montage. Directions [x (the left negative), up, front] from the head's
// centre at eyebrow height, as the 10–20 system on a sphere: Fp, F7/F8, T, P7/P8 and O on the ring
// just above the eyebrows and ears (NeuroLink: was placed higher, Fp1/Fp2 at the hairline).
const frontal = '额区参与注意调节、计划、工作记忆等多种过程。这些功能由分布式网络共同完成，不能用一个电极的振幅判断好坏。';
const central = '中央区附近包含感觉运动相关皮层。运动、运动想象和感觉输入可能伴随 μ / β 节律变化；是否出现需结合任务、基线和伪迹判断。';
const parietal = '顶区常参与身体感觉整合、空间加工和注意分配。这里记录的是头皮电位，不等同于直接测量某一项能力。';
const temporal = '颞区与听觉处理、语言及记忆网络有关。语言侧化因人而异，单个颞区电极不能独立测出语言或记忆能力。';
const occipital = '枕区与视觉处理密切相关。清醒闭眼时后部 α 节律常更明显，睁眼后可能减弱；这并不等于专注力升高或降低。';
export const CHANNELS = [
  ['Fp1','左侧额极区',[-.309,.03,.951],['注意调节','执行功能'],frontal,'靠近眼睛，眨眼和眼球活动很容易进入信号。'],
  ['Fp2','右侧额极区',[.309,.03,.951],['注意调节','执行功能'],frontal,'靠近眼睛，眨眼和眼球活动很容易进入信号。'],
  ['C3','左侧中央区',[-.719,.695,0],['感觉运动','右侧肢体相关'],central,'左侧运动皮层通常与右侧肢体控制有关，但头皮电极并非精确定位工具。'],
  ['C4','右侧中央区',[.719,.695,0],['感觉运动','左侧肢体相关'],central,'右侧运动皮层通常与左侧肢体控制有关，但头皮电极并非精确定位工具。'],
  ['P7','左侧后颞／顶区',[-.809,.03,-.588],['感觉整合','空间加工'],parietal,'旧命名常写作 T5。头动与附近肌肉活动都可能影响读数。'],
  ['P8','右侧后颞／顶区',[.809,.03,-.588],['感觉整合','空间加工'],parietal,'旧命名常写作 T6。头动与附近肌肉活动都可能影响读数。'],
  ['O1','左侧枕区',[-.309,.03,-.951],['视觉处理','后部 α 节律'],occipital,'后脑电极接触和眼睛睁闭状态都会影响记录。'],
  ['O2','右侧枕区',[.309,.03,-.951],['视觉处理','后部 α 节律'],occipital,'后脑电极接触和眼睛睁闭状态都会影响记录。'],
  ['F7','左侧外侧额区',[-.809,.03,.588],['额区加工','语言网络关联'],frontal,'靠近眼外侧和颞肌；眼动、咬牙可造成明显伪迹。'],
  ['F8','右侧外侧额区',[.809,.03,.588],['额区加工','注意网络关联'],frontal,'靠近眼外侧和颞肌；眼动、咬牙可造成明显伪迹。'],
  ['F3','左侧额区',[-.545,.5,.673],['工作记忆','执行功能'],frontal,'不要把 β 功率或 θ/β 比值直接解释为个人专注力。'],
  ['F4','右侧额区',[.545,.5,.673],['工作记忆','执行功能'],frontal,'不要把 β 功率或 θ/β 比值直接解释为个人专注力。'],
  ['T7','左侧颞区',[-1,.03,0],['听觉加工','语言网络关联'],temporal,'旧命名为 T3。颞肌和下颌活动可能产生较大的高频伪迹。'],
  ['T8','右侧颞区',[1,.03,0],['听觉加工','听觉空间信息'],temporal,'旧命名为 T4。颞肌和下颌活动可能产生较大的高频伪迹。'],
  ['P3','左侧顶区',[-.545,.5,-.673],['身体感觉整合','空间加工'],parietal,'后部 α 节律也可能在这里较明显，应结合其他电极观察。'],
  ['P4','右侧顶区',[.545,.5,-.673],['身体感觉整合','空间加工'],parietal,'后部 α 节律也可能在这里较明显，应结合其他电极观察。'],
].map(([name,region,direction,tags,description,note],i)=>({id:i+1,name,region,direction,tags,description,note}));
export const BANDS=[['delta','δ','1–4 Hz'],['theta','θ','4–8 Hz'],['alpha','α','8–13 Hz'],['beta','β','13–30 Hz'],['gamma','γ','30–40 Hz']];
export const SOURCES=[
 ['ACNS 电极命名与位置规范','https://www.acns.org/UserFiles/file/EEGGuideline2Electrodenomenclature_final_v1.pdf'],
 ['OpenStax：脑结构与功能','https://openstax.org/books/introduction-behavioral-neuroscience/pages/1-4-the-brain-structure-and-function'],
 ['EEG 容积传导与定位边界','https://pubmed.ncbi.nlm.nih.gov/22796039/'],
 ['心算任务与额中线 θ：实验研究','https://pubmed.ncbi.nlm.nih.gov/25941479/'],
 ['动作与 μ / β 节律变化：实验研究','https://pubmed.ncbi.nlm.nih.gov/9216482/'],
 ['头部肌肉对脑电的干扰：实验研究','https://pubmed.ncbi.nlm.nih.gov/25071531/'],
];
