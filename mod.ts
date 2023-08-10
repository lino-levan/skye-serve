import * as esbuild from "https://deno.land/x/esbuild@v0.17.19/wasm.js";
import { denoPlugins } from "https://deno.land/x/esbuild_deno_loader@0.8.1/mod.ts";
import { existsSync } from "https://deno.land/std@0.198.0/fs/mod.ts";
import { join } from "https://deno.land/std@0.198.0/path/join.ts";
import { resolve } from "https://deno.land/std@0.198.0/path/resolve.ts";
import { parse } from "https://deno.land/std@0.198.0/flags/mod.ts";

const exportAsDefaultRegex = /^\s+(.+)\sas\sdefault/m;

const serverArgs = parse(Deno.args, {
  string: ["base"],
});

const base = serverArgs.base ?? "./";

const cached: Map<string, Deno.ServeHandler> = new Map();

Deno.serve(async (req, res) => {
  const url = new URL(req.url);
  let path = "";

  if (existsSync(join(base, url.pathname + ".ts"))) {
    path = join(base, url.pathname + ".ts");
  } else if (existsSync(join(base, url.pathname, "index.ts"))) {
    path = join(base, url.pathname, "index.ts");
  } else if (existsSync(join(base, url.pathname))) {
    console.log(join(base, url.pathname));
    const file = await Deno.open(join(base, url.pathname));
    return new Response(file.readable);
  } else if (existsSync(join(base, "_404.ts"))) {
    path = join(base, "_404.ts");
  } else {
    return new Response(null, { status: 404 });
  }

  const cacheEntry = cached.get(path);
  if (cacheEntry) {
    return cacheEntry(req, res);
  }

  // Bundle file
  const result = await esbuild.build({
    plugins: [...denoPlugins()],
    entryPoints: [resolve("./" + path)],
    write: false,
    bundle: true,
    format: "esm",
  });

  // Do cursed stuff to convert to executable function
  let file = new TextDecoder().decode(result.outputFiles[0].contents);
  file = file.replaceAll("export", "return");
  const match = file.match(exportAsDefaultRegex);
  if (!match) {
    return new Response("Invalid file (no default export)");
  }
  file = file.replace(match[0], `  default: ${match[1]}`);

  // Run code :eyes:
  const runFile = new Function(file);
  const { default: run } = runFile();

  cached.set(path, run);

  return run(req, res);
});
