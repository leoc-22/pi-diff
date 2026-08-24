import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import open from "open";
import { DiffArgumentError, parseDiffArguments } from "./arguments.ts";
import { createDiffRequest } from "./git.ts";
import { DiffViewerServer } from "./server.ts";

export default function gitDiffExtension(pi: ExtensionAPI): void {
  let viewer: DiffViewerServer | undefined;

  pi.registerCommand("diff", {
    description: "Open a local Git diff in a browser (/diff [--staged | --ref REV] [@path])",
    handler: async (args, ctx) => {
      try {
        const options = parseDiffArguments(args);
        const request = await createDiffRequest(pi, ctx.cwd, options);
        viewer ??= new DiffViewerServer(pi);
        viewer.setRequest(request);
        const url = await viewer.start();

        try {
          await open(url, { wait: false });
          ctx.ui.notify(`Git diff opened: ${request.path ?? request.repositoryRoot}`, "info");
        } catch (error) {
          const reason = error instanceof Error ? ` (${error.message})` : "";
          ctx.ui.notify(`Could not open the browser${reason}. Open ${url}`, "warning");
        }
      } catch (error) {
        const message = error instanceof DiffArgumentError || error instanceof Error
          ? error.message
          : "Could not open the Git diff viewer.";
        ctx.ui.notify(`Git diff: ${message}`, "error");
      }
    },
  });

  pi.on("session_shutdown", async () => {
    await viewer?.close();
    viewer = undefined;
  });
}
