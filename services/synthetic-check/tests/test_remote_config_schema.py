"""The remote-config rules must follow the app's readers (R28 MONITOR).

checks.REMOTE_FEATURES and checks.REMOTE_IOS_KEYS describe what mobile/src/config/featureFlags.ts
(applyRemoteFeatures) and mobile/src/config/remoteConfig.ts (IosRemoteConfig) read. A flag added to the
app without a rule here is not checked; one removed from the app would still be checked. Either way this
test fails first, so the two lists move together.
"""

from __future__ import annotations

import re
from pathlib import Path

from synthetic_check.checks import DETAILS, REMOTE_FEATURES, REMOTE_IOS_KEYS, remote_config_problem

MOBILE_CONFIG = Path(__file__).resolve().parents[3] / "mobile" / "src" / "config"


def test_features_match_apply_remote_features() -> None:
    source = (MOBILE_CONFIG / "featureFlags.ts").read_text()
    body = source[source.index("export function applyRemoteFeatures") :]
    app_features = set(re.findall(r"\bfeatures\?\.(\w+)", body))
    assert app_features == set(REMOTE_FEATURES)
    app_leaves = {(feature, leaf) for feature, leaf in re.findall(r"\b(\w+)\?\.(\w+)", body) if feature in app_features}
    assert app_leaves == {(feature, leaf) for feature, leaves in REMOTE_FEATURES.items() for leaf in leaves}


def test_ios_keys_match_ios_remote_config() -> None:
    source = (MOBILE_CONFIG / "remoteConfig.ts").read_text()
    block = re.search(r"export type IosRemoteConfig = \{(.*?)\};", source, re.S)
    assert block is not None
    assert tuple(re.findall(r"^\s*(\w+)\?:", block.group(1), re.M)) == REMOTE_IOS_KEYS


def test_every_rule_id_is_a_known_detail() -> None:
    docs: list[object] = [
        None,
        {"ios": 1},
        {"ios": {"minSupportedVersion": "9.0"}},
        {"ios": {"minSupportedVersion": "9.0.0-rc1"}},
        {"features": 1},
        {"features": {"x": 1}},
        *({"ios": {key: 1}} for key in REMOTE_IOS_KEYS),
        *({"features": {name: 1}} for name in REMOTE_FEATURES),
        *({"features": {name: {leaf: "wrong"}}} for name, leaves in REMOTE_FEATURES.items() for leaf in leaves),
    ]
    for doc in docs:
        problem = remote_config_problem(doc)
        assert problem is None or problem in DETAILS, (doc, problem)
    assert remote_config_problem({"ios": {"minSupportedVersion": "9.0.0-rc1"}}) == "ios.minSupportedVersion"
