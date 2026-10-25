import type { SheriffConfig } from "@softarc/sheriff-core";
import type { RuleMatcherFn } from "@softarc/sheriff-core/src/lib/config/dependency-rules-config";

const canAccessTests: RuleMatcherFn = ({ fromFilePath, to }) => {
	if (to !== "type:test") {
		return true;
	}

	return fromFilePath.endsWith(".spec.ts") || fromFilePath.endsWith(".e2e-spec.ts");
};

export const config: SheriffConfig = {
	depRules: {
		noTag: ["noTag", "type:rule", "type:shared"],
		root: ["noTag", "type:rule", "type:shared"],
		"type:rule": ["noTag", "type:shared", canAccessTests],
		"type:shared": [canAccessTests],
		"type:test": ["noTag", "type:rule", "type:shared"]
	},
	enableBarrelLess: true,
	entryPoints: {
		core: "./packages/core/src/index.ts"
	},
	modules: {
		"packages/<package>/src": "type:shared",
		"packages/<package>/src/rules/<rule>": "type:rule",
		"packages/<package>/src/rules/<rule>/testing": "type:test",
		"packages/<package>/src/testing": "type:test"
	}
};
