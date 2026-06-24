const nextJest = require("next/jest");

const createJestConfig = nextJest({
  dir: "./",
});

const customJestConfig = {
  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
    "^@vercel/kv$": "<rootDir>/test/mocks/vercel-kv.ts",
    "^@animocabrands/minds-client-lib$":
      "<rootDir>/test/mocks/minds-client-lib.ts",
  },
  testPathIgnorePatterns: [
    "<rootDir>/.next/",
    "<rootDir>/node_modules/",
    "<rootDir>/e2e/",
  ],
  collectCoverageFrom: [
    "app/**/*.{ts,tsx}",
    "components/**/*.{ts,tsx}",
    "lib/**/*.{ts,tsx}",
    "services/**/*.{ts,tsx}",
    "!**/*.d.ts",
  ],
};

module.exports = createJestConfig(customJestConfig);
