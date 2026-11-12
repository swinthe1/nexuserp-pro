// The installer in Albanian. NSIS has its own Albanian texts (Next, Install, Finish…); electron-builder's own
// pages (who the program is for, the program is running…) have none, so they are added here before the build:
//   node nsis-shqip.mjs && npx electron-builder --win nsis --x64
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const require = createRequire(import.meta.url)
const lib = require.resolve('app-builder-lib/package.json')
const yaml = createRequire(lib)('js-yaml')   // electron-builder's own copy
const dir = path.join(path.dirname(lib), 'templates', 'nsis')

const SQ = {
  'assistedMessages.yml': {
    chooseInstallationOptions: 'Zgjidhni mënyrën e instalimit',
    chooseUninstallationOptions: 'Zgjidhni mënyrën e çinstalimit',
    whichInstallationShouldBeRemoved: 'Cili instalim të hiqet?',
    whoShouldThisApplicationBeInstalledFor: 'Për kë të instalohet programi?',
    selectUserMode: 'Zgjidhni nëse programin do ta përdorin të gjithë përdoruesit e këtij kompjuteri apo vetëm ju',
    whichInstallationRemove: 'Programi është instaluar edhe për të gjithë përdoruesit, edhe vetëm për ju.\nCilin instalim doni ta hiqni?',
    freshInstallForAll: 'Instalim i ri për të gjithë përdoruesit. (kërkon fjalëkalimin e administratorit)',
    freshInstallForCurrent: 'Instalim i ri vetëm për këtë përdorues.',
    onlyForMe: 'Vetëm për &mua',
    forAll: 'Për të &gjithë ata që e përdorin këtë kompjuter',
    loginWithAdminAccount: 'Për të vazhduar duhet të hyni me një llogari administratori...',
    perUserInstallExists: 'Programi është tashmë i instaluar për këtë përdorues.',
    perUserInstall: 'Ka një instalim për këtë përdorues.',
    perMachineInstallExists: 'Programi është tashmë i instaluar për të gjithë përdoruesit.',
    perMachineInstall: 'Ka një instalim për të gjithë përdoruesit.',
    reinstallUpgrade: 'Do të instalohet përsëri ose do të përditësohet.',
    uninstall: 'Do të çinstalohet.',
  },
  'messages.yml': {
    win7Required: 'Kërkohet Windows 7 ose më i ri',
    x64WinRequired: 'Kërkohet Windows 64-bit',
    appRunning: '${PRODUCT_NAME} është i hapur.\nShtypni OK për ta mbyllur.\nNëse nuk mbyllet, mbylleni vetë.',
    appCannotBeClosed: '${PRODUCT_NAME} nuk mund të mbyllet.\nMbylleni vetë dhe shtypni Provo përsëri për të vazhduar.',
    installing: 'Po instalohet, ju lutemi prisni...',
    areYouSureToUninstall: 'A jeni i sigurt që doni ta çinstaloni ${PRODUCT_NAME}?',
    decompressionFailed: 'Skedarët nuk u shpaketuan. Provoni ta hapni instaluesin përsëri.',
    uninstallFailed: 'Skedarët e versionit të vjetër nuk u hoqën. Provoni ta hapni instaluesin përsëri.',
  },
}

for (const [file, texts] of Object.entries(SQ)) {
  const p = path.join(dir, file)
  const all = yaml.load(readFileSync(p, 'utf8'))
  const missing = Object.keys(all).filter((k) => !(k in texts))
  if (missing.length) throw new Error(`${file}: no Albanian for ${missing.join(', ')}`)
  for (const [k, v] of Object.entries(texts)) { if (!all[k]) throw new Error(`${file}: ${k} is not a message of this electron-builder`); all[k].sq = v }
  writeFileSync(p, yaml.dump(all, { lineWidth: -1 }))
  console.log(`${file}: ${Object.keys(texts).length} texts in Albanian`)
}
