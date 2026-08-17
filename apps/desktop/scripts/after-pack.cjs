const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
const path = require('node:path');

/**
 * electron-builder afterPack hook：在打包完成、签名之前翻转安全 fuses。
 * 翻转不可逆（除重新打包），范围锁定为安全加固所需集合：
 * - 关闭 RunAsNode / NODE_OPTIONS / --inspect 调试入口；
 * - 开启 app.asar 完整性校验与「仅从 asar 加载」；
 * - 开启 WASM 越界 trap。
 * 刻意不翻：
 * - LoadBrowserProcessSpecificV8Snapshot：Electron 43 分发不含
 *   browser_v8_context_snapshot.bin，启用后 V8 启动即崩（实测）；
 * - cookieEncryption：本项目无 Web cookie 用途，且是单向迁移；
 * - GrantFileProtocolExtraPrivileges：渲染器从 file:// 加载，保持默认。
 */
module.exports = async function afterPack(context) {
  const { electronPlatformName, appOutDir, packager } = context;
  const productName = packager.appInfo.productFilename;

  let executable;

  if (electronPlatformName === 'darwin') {
    executable = path.join(appOutDir, `${productName}.app`, 'Contents', 'MacOS', productName);
  } else if (electronPlatformName === 'win32') {
    executable = path.join(appOutDir, `${productName}.exe`);
  } else {
    executable = path.join(appOutDir, productName);
  }

  await flipFuses(executable, {
    version: FuseVersion.V1,
    // electron-builder Arch 枚举：3 = arm64；macOS arm64 翻转后需重置 ad-hoc 签名。
    resetAdHocDarwinSignature: electronPlatformName === 'darwin' && context.arch === 3,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.WasmTrapHandlers]: true
  });
};
