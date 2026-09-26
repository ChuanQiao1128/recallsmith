// Expo config plugin (1.7.0): Xcode 27 rejects pod targets whose IPHONEOS_DEPLOYMENT_TARGET is
// below iOS 15 (RevenueCat/PurchasesHybridCommon 13.0, AsyncStorage 13.4, Reachability 12.0).
// EAS builds with image "latest", so the store build would fail the same way. This inserts a
// loop at the top of the Podfile's post_install that raises every pod target below MIN to MIN.
// Idempotent (marker line), no-op on older Xcode, never lowers a target.
const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

const MIN = '15.1';
const MARK = '# withPodsDeploymentTarget';

function patchPodfile(src) {
  if (src.includes(MARK)) return src;
  const hook = /post_install do \|installer\|\n/;
  if (!hook.test(src)) throw new Error('withPodsDeploymentTarget: post_install block not found in Podfile');
  return src.replace(hook, (m) =>
    m +
    `    ${MARK}: raise pod targets below iOS ${MIN} (Xcode 27 rejects them)\n` +
    `    installer.pods_project.targets.each do |t|\n` +
    `      t.build_configurations.each do |c|\n` +
    `        if c.build_settings['IPHONEOS_DEPLOYMENT_TARGET'].to_f < ${MIN}\n` +
    `          c.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '${MIN}'\n` +
    `        end\n` +
    `      end\n` +
    `    end\n`,
  );
}

function withPodsDeploymentTarget(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const podfile = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      fs.writeFileSync(podfile, patchPodfile(fs.readFileSync(podfile, 'utf8')));
      return cfg;
    },
  ]);
}

module.exports = withPodsDeploymentTarget;
module.exports.patchPodfile = patchPodfile;
