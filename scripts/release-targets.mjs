// 发布安装包清单，与 apps/desktop/electron-builder.yml 的 artifactName 模板保持一致。
// Linux 的 arch 会被 builder-util 的 getArtifactArchName 改写为生态惯例名
// （AppImage → x86_64，deb → amd64），win/mac 保持 x64/arm64。
export const RELEASE_TARGETS = [
  'win-x64.exe',
  'linux-x86_64.AppImage',
  'linux-amd64.deb',
  'mac-x64.dmg',
  'mac-x64.zip',
  'mac-arm64.dmg',
  'mac-arm64.zip'
];

/** 展开为完整安装包文件名。 */
export const releaseArtifactNames = version => RELEASE_TARGETS.map(target => `Chaptale-${version}-${target}`);
