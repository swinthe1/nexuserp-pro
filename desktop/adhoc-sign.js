// After packing the Mac program: sign it "ad hoc" (no Apple certificate yet), which Apple Silicon Macs
// need before they run a program at all. With an Apple Developer ID this step is replaced by real signing.
const { execFileSync } = require('child_process')
const path = require('path')
exports.default = async function (context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
}
