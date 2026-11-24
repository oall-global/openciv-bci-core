// 设置: the device, development tools in development builds.
let dev = false;
try {
  dev = wx.getAccountInfoSync().miniProgram.envVersion === 'develop';
} catch (e) {
  dev = false;
}

Page({
  data: {
    dev,
    devices: [],
  },
  onShow() {
    if (this.getTabBar) this.getTabBar().setData({ selected: 2 });

    this.setData({
      devices: JSON.parse(wx.getStorageSync('bci.devices') || '[]'),
    });
  },
  go(e) {
    wx.navigateTo({ url: e.currentTarget.dataset.url });
  },
});
