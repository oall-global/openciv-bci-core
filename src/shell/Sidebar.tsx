import logoUrl from '../assets/logo.png';
import { Activity, BookOpen, Database, Radio, Settings2, SlidersHorizontal } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type NavItem = [id: string, icon: LucideIcon, label: string, hint: string];

// Every place in the app is named in the left column, always visible. The labels match the page
// titles (and what the end-to-end tests click).
const PRIMARY: NavItem[] = [
  ['home', Activity, '信号工作台', '实时脑电与图表'],
  ['data', Database, '脑电数据库', '本机的全部脑电记录'],
];
export const TOOL_GROUPS: { title: string; items: NavItem[] }[] = [
  { title: '设备', items: [['devices', Radio, '设备', '连接与网络']] },
  { title: '专业', items: [['developer', SlidersHorizontal, '开发者工作台', '本机接口与标记']] },
  {
    title: '帮助',
    items: [
      ['glossary', BookOpen, '概念手册', '脑电与信号处理的各项概念'],
      ['settings', Settings2, '设置', '外观、隐私与关于'],
    ],
  },
];

export default function Sidebar({
  page,
  onHome,
  onTool,
}: {
  page: string;
  onHome: () => void;
  onTool: (page: string) => void;
}) {
  const item = ([id, Icon, label, hint]: NavItem) => {
    const here = page === id || (id === 'data' && page === 'moments');
    return (
      <button
        key={id}
        aria-label={label}
        title={hint}
        className={here ? 'active' : ''}
        aria-current={here ? 'page' : undefined}
        onClick={() => (id === 'home' ? onHome() : onTool(id))}
      >
        <Icon size={16} />
        {label}
      </button>
    );
  };
  return (
    <aside className="sb" aria-label="导航">
      <button className="sb-brand" onClick={onHome} aria-label="开源文明 BCI-001 首页">
        <img src={logoUrl} width="34" height="34" alt="" />
        <span>开源文明 BCI-001</span>
      </button>
      <nav className="sb-nav sb-primary" aria-label="主要页面">
        {PRIMARY.map(item)}
      </nav>
      <nav className="sb-nav sb-tools-nav" aria-label="工具与设置">
        {TOOL_GROUPS.map((g) => (
          <div key={g.title} className="sb-group" role="group" aria-label={g.title}>
            <small>{g.title}</small>
            {g.items.map(item)}
          </div>
        ))}
      </nav>
    </aside>
  );
}
