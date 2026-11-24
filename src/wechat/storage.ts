// localStorage for the desktop modules the mini program shares (src/home/brainHistory.ts keeps its
// baseline there): WeChat's own storage under the same keys. Imported before them.
declare const wx: any; // eslint-disable-line @typescript-eslint/no-explicit-any
const g = globalThis as Record<string, unknown>;
if (typeof g.localStorage === 'undefined')
  g.localStorage = {
    getItem: (k: string) => {
      const v = wx.getStorageSync(k);
      return v === '' || v === undefined ? null : String(v);
    },
    setItem: (k: string, v: string) => wx.setStorageSync(k, String(v)),
    removeItem: (k: string) => wx.removeStorageSync(k),
  };
