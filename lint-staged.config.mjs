// @ts-check
/**
 * @type {import("lint-staged").Configuration}
 */
export default {
	"**/*.{ts,json}": ["eslint --fix", "oxfmt --no-error-on-unmatched-pattern"],
	"**/*.ts": ["tsc-files --noEmit -p tsconfig.eslint.json"]
};
