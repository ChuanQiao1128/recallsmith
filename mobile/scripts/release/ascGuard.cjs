'use strict';
// ascGuard.cjs — pure checks for asc-release.cjs (no Apple session, no network, no child processes).
//
// Apple holds a version once it is submitted: renaming it to the target version or attaching another
// build would pull it from review or change what Apple is reviewing or about to release.

exports.BLOCKED_EDIT_STATES = ['WAITING_FOR_REVIEW', 'IN_REVIEW', 'PENDING_DEVELOPER_RELEASE'];

// attrs: the editable App Store version's attributes (null/undefined when there is none).
// Returns { ok: true } or { ok: false, state, reason }.
exports.checkEditableVersion = (attrs, target) => {
  if (!attrs) return { ok: true };
  for (const key of ['appVersionState', 'appStoreState']) {
    const state = attrs[key];
    if (exports.BLOCKED_EDIT_STATES.includes(state)) {
      return {
        ok: false,
        state,
        reason: 'App Review holds this version (' + key + '); renaming it to ' + String(target) +
          ' or attaching a build would pull or change it. Wait for the review outcome or release it first.',
      };
    }
  }
  return { ok: true };
};

// versions: the attributes of every App Store version that could hold the release (the editable one,
// the one in review and the one pending release; null/undefined entries are skipped). The editable
// version alone is not enough: apple-utils' getEditAppStoreVersionAsync filters out IN_REVIEW and
// PENDING_*_RELEASE versions, so those have to be read separately and checked here.
// Returns { ok: true } or the first refusal of checkEditableVersion plus the held versionString.
exports.firstHeldVersion = (versions, target) => {
  for (const attrs of versions || []) {
    const r = exports.checkEditableVersion(attrs, target);
    if (!r.ok) return Object.assign({ versionString: String(attrs.versionString) }, r);
  }
  return { ok: true };
};
