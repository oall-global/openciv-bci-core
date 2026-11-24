// development builds report to the developer's computer (lib/devlog.js)
require('./lib/devlog.js');

App({
  // development builds opened with ?demo=1 run on the simulated device (as the desktop --demo);
  // release builds have no simulated device
  onLaunch(options) {
    let dev = false;
    try {
      dev = wx.getAccountInfoSync().miniProgram.envVersion === 'develop';
    } catch (e) {
      dev = false;
    }
    if (dev && options && options.query && options.query.demo === '1')
      require('./lib/core.js').connect('demo');
  },
});
