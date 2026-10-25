// @ts-check

const githubPrReference = /\(#\d+\)/;

/**
 * @type {import("@commitlint/types").UserConfig}
 */
export default {
	extends: ["@commitlint/config-conventional"],
	ignores: [(message) => githubPrReference.test(message.split("\n", 1)[0] ?? "")]
};
