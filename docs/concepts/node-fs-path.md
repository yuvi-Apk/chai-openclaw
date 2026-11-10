# Working with files: `node:fs`, `node:path`, and `node:child_process`

Bun supports Node's built-in modules. The `node:` prefix means "this comes with the runtime, not from `node_modules`".

## `node:fs`: the file system

```ts
import fs from "node:fs";

fs.existsSync("a.txt");                       // does it exist?
fs.statSync("a.txt").isFile();                // is it a file (not a folder)?
fs.statSync("a.txt").size;                    // size in bytes
fs.readFileSync("a.txt", "utf8");             // read as text
fs.writeFileSync("a.txt", "hi", "utf8");      // write text
fs.mkdirSync("a/b/c", { recursive: true });   // make folders, like `mkdir -p`
fs.rmSync("a.txt", { force: true });          // delete, no error if missing
fs.readdirSync("src", { withFileTypes: true });// list entries (with isDirectory())
```

The `Sync` versions **wait** until the job is done before moving on. They're simple to read and fine for a CLI where one person is waiting anyway.

## `node:path`: building paths safely

```ts
import path from "node:path";

path.join("src", "a.ts");             // "src/a.ts" (or "src\\a.ts" on Windows)
path.resolve("/project", "src/a.ts"); // an absolute path
path.relative("/project", "/project/src/a.ts"); // "src/a.ts"
path.extname("a.ts");                 // ".ts"
path.dirname("src/a.ts");             // "src"
path.sep;                             // "/" on Mac/Linux, "\\" on Windows
path.posix.normalize("./a//b");       // always uses "/": "a/b"
```

Never glue paths together with `+`. `path` handles Windows vs Mac/Linux slashes for you.

### The "stay inside the folder" trick

```ts
const abs = path.resolve(root, userPath);
const rel = path.relative(root, abs);
if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("escapes root");
```

If the relative path from `root` starts with `..`, the target is *outside* `root`. This is a standard guard against **path traversal** (like `../../etc/passwd`).

## `node:child_process`: running shell commands

```ts
import { spawnSync } from "node:child_process";

const r = spawnSync("bun test", { shell: true, cwd: "/project", encoding: "utf8" });
r.status;   // exit code (0 = success)
r.stdout;   // what it printed
```

- `shell: true`: run it through the system shell, so a whole command string works.
- `cwd`: which folder to run it in.

## `node:os`

`homedir()` gives the user's home folder, like `C:\Users\you` or `/home/you`.

💡 **Tip:** Recursive "walk" functions (a function that calls itself for each sub-folder) are the classic way to visit every file in a tree.

**Used in:** [files/modes/agent/tool-executor.ts.md](../files/modes/agent/tool-executor.ts.md)
