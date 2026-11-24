export type UsbNetworkIdentity = { mode?: number; address?: string };
export function usbNetworkHint(device: UsbNetworkIdentity | null | undefined) {
  if (!device)
    return {
      address: '',
      mode: null,
      message: '未收到所选 USB 设备的身份回复，请检查 USB 连接或串口占用后重试。',
    };
  if (device.mode === 1)
    return {
      address: device.address || '192.168.4.1',
      mode: 'direct' as const,
      message: device.address
        ? '设备当前为直连热点模式，已读取地址。请让电脑连接设备热点，再验证地址。'
        : '设备当前为直连热点模式，本固件未返回 IP。已预填常用热点地址 192.168.4.1（尚未验证）；请先在 Windows Wi-Fi 中加入设备热点，再点击验证地址。',
    };
  if (device.mode === 2)
    return {
      address: device.address || '',
      mode: 'router' as const,
      message: device.address
        ? '已读取设备地址，请点击验证地址或寻找设备。'
        : '设备当前为路由器模式，但尚未返回地址。请等待设备加入目标 Wi-Fi 后重读；仍无地址时，核对 Wi-Fi 名称和密码，或从路由器查看设备地址。',
    };
  if (device.mode === 3)
    return {
      address: '',
      mode: null,
      message: '设备当前为蓝牙模式。请返回连接方式，通过 USB 配置为直连或路由器模式。',
    };
  return {
    address: device.address || '',
    mode: null,
    message: device.address
      ? '已读取设备地址，请点击验证地址或寻找设备。'
      : 'USB 已识别，但未返回网络模式或地址。请按所选模式连接网络，再搜索或手动验证设备地址。',
  };
}
