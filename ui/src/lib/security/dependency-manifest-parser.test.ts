import { describe, expect, it } from "vitest";

import {
  isManifestPath,
  mergeManifestPackages,
  parseManifest,
} from "./dependency-manifest-parser";

describe("isManifestPath", () => {
  it("matches known manifest basenames at any depth", () => {
    expect(isManifestPath("package.json")).toBe(true);
    expect(isManifestPath("sub/dir/requirements.txt")).toBe(true);
    expect(isManifestPath("go.mod")).toBe(true);
    expect(isManifestPath("Cargo.lock")).toBe(true);
    expect(isManifestPath("src/index.ts")).toBe(false);
    expect(isManifestPath("README.md")).toBe(false);
  });
});

describe("package.json", () => {
  it("extracts direct deps as range-min versions", () => {
    const pkgs = parseManifest(
      "package.json",
      JSON.stringify({
        dependencies: { lodash: "^4.17.20" },
        devDependencies: { vitest: "~1.2.0" },
      })
    );
    const lodash = pkgs.find((p) => p.name === "lodash");
    expect(lodash).toMatchObject({
      ecosystem: "npm",
      version: "4.17.20",
      direct: true,
      precision: "range-min",
    });
    const vitest = pkgs.find((p) => p.name === "vitest");
    expect(vitest?.version).toBe("1.2.0");
  });

  it("skips non-version specifiers (git/workspace/*)", () => {
    const pkgs = parseManifest(
      "package.json",
      JSON.stringify({
        dependencies: {
          a: "*",
          b: "workspace:*",
          c: "github:foo/bar",
          d: "1.0.0",
        },
      })
    );
    const names = pkgs.map((p) => p.name);
    expect(names).toContain("d");
    expect(names).not.toContain("a");
    expect(names).not.toContain("b");
    expect(names).not.toContain("c");
  });
});

describe("package-lock.json v7+", () => {
  it("extracts pinned versions from packages map", () => {
    const pkgs = parseManifest(
      "package-lock.json",
      JSON.stringify({
        packages: {
          "": { name: "root" },
          "node_modules/lodash": { version: "4.17.21" },
          "node_modules/foo/node_modules/bar": { version: "1.0.0" },
        },
      })
    );
    const lodash = pkgs.find((p) => p.name === "lodash");
    expect(lodash).toMatchObject({ version: "4.17.21", precision: "pinned" });
    expect(pkgs.find((p) => p.name === "bar")?.version).toBe("1.0.0");
  });

  it("only root-listed deps are direct — hoisted transitives are not", () => {
    const pkgs = parseManifest(
      "package-lock.json",
      JSON.stringify({
        packages: {
          "": {
            name: "root",
            dependencies: { react: "^18.0.0" },
            devDependencies: { vitest: "^1.0.0" },
          },
          "node_modules/react": { version: "18.3.1" },
          "node_modules/vitest": { version: "1.2.0" },
          // hoisted transitive: top-level path but not in root deps
          "node_modules/minimatch": { version: "3.1.2" },
        },
      })
    );
    expect(pkgs.find((p) => p.name === "react")?.direct).toBe(true);
    expect(pkgs.find((p) => p.name === "vitest")?.direct).toBe(true);
    expect(pkgs.find((p) => p.name === "minimatch")?.direct).toBe(false);
  });
});

describe("yarn.lock", () => {
  it("reads resolved versions", () => {
    const content = `# yarn lockfile v1
"lodash@^4.17.0", lodash@^4.17.20:
  version "4.17.21"
  resolved "https://registry.yarnpkg.com/lodash/-/lodash-4.17.21.tgz"

"@babel/core@^7.0.0":
  version "7.20.0"
`;
    const pkgs = parseManifest("yarn.lock", content);
    expect(pkgs.find((p) => p.name === "lodash")?.version).toBe("4.17.21");
    expect(pkgs.find((p) => p.name === "@babel/core")?.version).toBe("7.20.0");
  });
});

describe("requirements.txt", () => {
  it("only pins exact == versions", () => {
    const content = `flask==2.0.1
requests>=2.25
# comment
django == 4.1.0
-e .
`;
    const pkgs = parseManifest("requirements.txt", content);
    expect(pkgs.find((p) => p.name === "flask")?.version).toBe("2.0.1");
    expect(pkgs.find((p) => p.name === "django")?.version).toBe("4.1.0");
    expect(pkgs.find((p) => p.name === "requests")).toBeUndefined();
    for (const p of pkgs) expect(p.ecosystem).toBe("PyPI");
  });
});

describe("go.mod", () => {
  it("reads require block and marks indirect", () => {
    const content = `module example.com/x

go 1.21

require (
	github.com/gin-gonic/gin v1.9.1
	golang.org/x/crypto v0.14.0 // indirect
)
`;
    const pkgs = parseManifest("go.mod", content);
    const gin = pkgs.find((p) => p.name === "github.com/gin-gonic/gin");
    expect(gin).toMatchObject({ ecosystem: "Go", version: "1.9.1", direct: true });
    const crypto = pkgs.find((p) => p.name === "golang.org/x/crypto");
    expect(crypto?.direct).toBe(false);
  });
});

describe("Cargo.lock", () => {
  it("reads [[package]] blocks", () => {
    const content = `[[package]]
name = "serde"
version = "1.0.190"

[[package]]
name = "tokio"
version = "1.33.0"
`;
    const pkgs = parseManifest("Cargo.lock", content);
    expect(pkgs.find((p) => p.name === "serde")?.version).toBe("1.0.190");
    expect(pkgs.find((p) => p.name === "tokio")?.ecosystem).toBe("crates.io");
  });
});

describe("mergeManifestPackages", () => {
  it("prefers pinned over range-min for the same package+version", () => {
    const merged = mergeManifestPackages([
      [
        {
          ecosystem: "npm",
          name: "lodash",
          version: "4.17.21",
          direct: true,
          precision: "range-min",
          sourceFile: "package.json",
        },
      ],
      [
        {
          ecosystem: "npm",
          name: "lodash",
          version: "4.17.21",
          direct: false,
          precision: "pinned",
          sourceFile: "package-lock.json",
        },
      ],
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ precision: "pinned", direct: true });
  });

  it("propagates directness by name from package.json to lockfile pins", () => {
    // package.json knows react is direct (but only a range); yarn.lock knows
    // the exact version (but nothing about directness).
    const merged = mergeManifestPackages([
      [
        {
          ecosystem: "npm",
          name: "react",
          version: "18.0.0",
          direct: true,
          precision: "range-min",
          sourceFile: "package.json",
        },
      ],
      [
        {
          ecosystem: "npm",
          name: "react",
          version: "18.3.1",
          direct: false,
          precision: "pinned",
          sourceFile: "yarn.lock",
        },
        {
          ecosystem: "npm",
          name: "minimatch",
          version: "3.1.2",
          direct: false,
          precision: "pinned",
          sourceFile: "yarn.lock",
        },
      ],
    ]);
    const pinnedReact = merged.find(
      (p) => p.name === "react" && p.version === "18.3.1"
    );
    expect(pinnedReact?.direct).toBe(true);
    expect(merged.find((p) => p.name === "minimatch")?.direct).toBe(false);
  });
});
