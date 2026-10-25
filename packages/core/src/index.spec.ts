import { describe, expect, it } from "vitest";

import { helloWorld } from ".";

describe(helloWorld, () => {
	it("should return 'Hello World'", () => {
		expect.assertions(1);
		expect(helloWorld()).toBe("Hello World");
	});
});
