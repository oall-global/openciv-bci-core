// The three tabs: 信号工作台 · 脑电数据库 · 设置. Each tab page sets
// `selected` in its onShow (getTabBar()).
const TABS = [
  { path: '/pages/workbench/index', text: '信号工作台', icon: 'workbench' },
  { path: '/pages/data/index', text: '脑电数据库', icon: 'data' },
  { path: '/pages/settings/index', text: '设置', icon: 'settings' },
];

Component({
  // hidden: under a page's bottom sheet (the bar is drawn above the page)
  data: { selected: 0, tabs: TABS, hidden: false },
  methods: {
    go(e) {
      const i = e.currentTarget.dataset.i;
      if (i === this.data.selected) return;
      wx.switchTab({ url: TABS[i].path });
    },
  },
});
