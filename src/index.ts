#!/usr/bin/env node
import { CliArgError, MELTA_ROOT_FLAG, parseMeltaRootArg } from "./cli-args.js";
import { setMeltaRoot } from "./utils/loader.js";
import { startServer } from "./server.js";

// アセット root の差し替えはサーバー起動前に確定させる（起動後の差し替えは不可）
try {
  const cliRoot = parseMeltaRootArg(process.argv.slice(2));
  if (cliRoot !== null) {
    setMeltaRoot(cliRoot, `${MELTA_ROOT_FLAG}=${cliRoot}`);
  }
} catch (error) {
  console.error(
    error instanceof CliArgError ? error.message : `[melta-ui] 引数の解釈に失敗しました: ${error}`
  );
  process.exit(1);
}

startServer().catch((error) => {
  console.error("Failed to start melta-ui MCP server:", error);
  process.exit(1);
});
